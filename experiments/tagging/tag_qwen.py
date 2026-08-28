#!/usr/bin/env python3
"""
Sandbox for the shipped image-tagging pipeline (src/convex/tagging.ts).

`tag_image()` mirrors the production Convex action `tagging.callOpenRouter`:
take image bytes + content-type, return a validated tag dict (or raise). The
PROMPT string, model params, and normalization/validation logic here are the
canonical source — production is a byte-for-byte port. Iterate here first,
then port changes to tagging.ts and bump PROMPT_VERSION there.

Everything outside `tag_image()` is experiment harness. Preprocessing differs
from production (sips→JPEG here vs sharp→JPEG q85 in taggingActions.ts) but
both downscale to a 1024px long edge. Palette extraction (Color Thief MMCQ →
paletteHex/paletteNames) is production-only and not part of this experiment.

Usage:
    OPENROUTER_API_KEY=sk-or-... python3 tag_qwen.py [model ...]

With no args, runs the production default model. With one or more OpenRouter
model slugs, runs the full image set against each and writes one
results_<slug>.json per model.
"""

import base64
import json
import mimetypes
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

API_KEY = os.environ.get("OPENROUTER_API_KEY")
if not API_KEY:
    sys.exit("set OPENROUTER_API_KEY")

# Keep in sync with DEFAULT_MODEL / PROMPT_VERSION in src/convex/tagging.ts.
DEFAULT_MODEL = "openai/gpt-5.6-luna"
PROMPT_VERSION = "v4"
MAX_EDGE_PX = 1024  # downscale long edge to this before sending
TEMPERATURE = 0.3  # low; re-tagging same item should be ~stable
MAX_TOKENS = 600  # JSON output is small; cap to control runaway
TIMEOUT_S = 60
RETRIES = 2  # plus one initial attempt = 3 total
RETRY_BACKOFF_S = (1, 3)


# ---------------------------------------------------------------------------
# Prompt
# ---------------------------------------------------------------------------
# Notes on this revision:
# - Example style vocabulary is no longer inside the JSON schema field
#   comment, where small models tended to copy it back verbatim. It now sits
#   in a separate "guidance" paragraph with an explicit anti-copy instruction.
# - The vocabulary list is broader and grouped by domain so the model has more
#   to draw on without being anchored to one set.
PROMPT = """You are tagging an image for a personal visual reference library. The image will be one of: an artwork or illustration, a graphic design piece, a screenshot of a website or digital interface, or a photograph. Your job is to produce structured tags so the user can rediscover this item later. Aesthetic style is the primary axis — spend the most thought there. Also capture the literal content (subject, concrete tags), since those help recall too.

Return ONLY a JSON object matching this schema. No prose, no markdown fences.

{
  "styles": string[],    // PRIMARY FIELD. 2-8 specific aesthetic/genre labels — what categories does this belong to.
  "subject": string,     // one sentence under 30 words — what's depicted at a glance, not an exhaustive description.
  "tags": string[]       // 5-12 concrete observations — specific objects, materials, motifs, technical details that the user could later search for. Distinct from styles; do not duplicate.
}

Style vocabulary guidance (inspirational, not prescriptive):
- Design / web movements: brutalist, swiss, international typographic, memphis, y2k, vaporwave, post-internet, skeuomorphic, neumorphism, glassmorphism, terminal, ascii.
- Art movements: art deco, art nouveau, bauhaus, constructivist, cubist, surrealist, expressionist, mid-century modern, ukiyo-e, gothic, baroque.
- Illustration / digital: anime, manga, lo-fi, concept art, low-poly, ps1, ps2, pixel art, vector flat, isometric, risograph, halftone, zine, editorial illustration.
- Photographic: documentary, street, portrait, fashion editorial, still life, film grain, polaroid, lomography.
- General descriptors: minimalist, maximalist, monochrome, high-contrast, hand-drawn, generative, glitch, surreal.
DO NOT pick a label merely because it appears in the list above. If none of these fit, propose a more accurate label. If something clearly fits, use it.

Rules:
- Do NOT name specific artists, designers, studios, or brands unless their identity is unambiguous from a visible signature, logo, or watermark in the image.
- For each style, pick the label that most accurately describes the image — neither broader nor narrower than the image warrants.
- If the image contains text that would itself act as a distinct/memorable search anchor later — a title, headline, signage with real content, distinctive graffiti, or a brand/product name — include up to 3 of them as tags (no longer than a short phrase). Skip generic UI chrome, serial numbers, version strings, and any text that isn't recognizable out of context.
"""


# ---------------------------------------------------------------------------
# Image preprocessing
# ---------------------------------------------------------------------------
def downscale_to_data_url(
    path: Path, max_edge: int = MAX_EDGE_PX
) -> tuple[str, int, str]:
    """Downscale image to max_edge on its long side, return (data_url, byte_size, mime).

    In production this would run inside a Convex action via Pillow or Sharp.
    Here we use macOS `sips` since Pillow isn't installed. sips can't write
    webp, so we always normalize output to JPEG — fine for tagging.
    """
    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
        tmp_path = Path(tmp.name)
    try:
        try:
            subprocess.run(
                [
                    "sips",
                    "-s",
                    "format",
                    "jpeg",
                    "-Z",
                    str(max_edge),
                    str(path),
                    "--out",
                    str(tmp_path),
                ],
                check=True,
                capture_output=True,
            )
            raw = tmp_path.read_bytes()
            mime = "image/jpeg"
        except subprocess.CalledProcessError:
            # downscale failed; send original
            raw = path.read_bytes()
            mime = mimetypes.guess_type(path.name)[0] or "image/png"
    finally:
        tmp_path.unlink(missing_ok=True)

    b64 = base64.b64encode(raw).decode("ascii")
    return f"data:{mime};base64,{b64}", len(raw), mime


# ---------------------------------------------------------------------------
# Tag normalization
# ---------------------------------------------------------------------------
# Words ending in -s that aren't actually plurals ("lens" → "len"), plus
# proper nouns the singularizer would mangle ("climeworks" → "climework").
# Add as we find more false positives.
KEEP_PLURAL = {
    "lens", "iris", "series", "species", "analysis", "axis", "chaos",
    "climeworks", "beaux-arts",
}

# Trailing modifier words that add no search value when attached to a real
# tag ("low-poly aesthetic" → "low-poly"). Only stripped when there's at
# least one other word — a standalone "aesthetic" stays as-is per the design
# note that the model's perspective should mostly come through.
GENERIC_MODIFIERS = {"aesthetic", "style", "vibes", "vibe"}

# Words that are noise as a suffix — either as a trailing space-separated
# word ("editorial design" → "editorial") or as a hyphenated tail
# ("swiss-influenced" → "swiss", "typography-driven" → "typography"). They
# remain meaningful as standalone single-word tags, so only stripped when
# attached.
SUFFIX_NOISE = {"design", "influenced", "driven", "based", "heavy"}


def singularize_word(w: str) -> str:
    if len(w) <= 3 or w in KEEP_PLURAL:
        return w
    if w.endswith(("ss", "us", "is", "os")):
        return w
    if w.endswith("ies") and len(w) > 4:
        return w[:-3] + "y"
    if w.endswith("ves") and len(w) > 4:
        return w[:-3] + "f"
    if w.endswith(("ses", "xes", "zes", "ches", "shes")):
        return w[:-2]
    if w.endswith("s"):
        return w[:-1]
    return w


def normalize_tag(s: str) -> str:
    s = " ".join(s.lower().split())
    s = s.strip(".,;:!?\"'`")
    if not s:
        return s
    words = s.split()
    while len(words) > 1 and (
        words[-1] in GENERIC_MODIFIERS or words[-1] in SUFFIX_NOISE
    ):
        words.pop()
    if words:
        last = words[-1]
        for suffix in SUFFIX_NOISE:
            ending = f"-{suffix}"
            if last.endswith(ending) and len(last) > len(ending):
                words[-1] = last[: -len(ending)]
                break
    # Singularize only the head noun. Interior plural words are usually part
    # of proper names or compounds ("substans conference", "systems design")
    # where singularizing corrupts the search anchor.
    words[-1] = singularize_word(words[-1])
    return " ".join(words)


def dedupe_preserve_order(items):
    seen = set()
    out = []
    for x in items:
        if x and x not in seen:
            seen.add(x)
            out.append(x)
    return out


# ---------------------------------------------------------------------------
# Schema validation
# ---------------------------------------------------------------------------
class TagSchemaError(ValueError):
    pass


def validate_tags(d: dict) -> dict:
    """Lightweight schema check + normalization. Raise TagSchemaError on violation."""
    if not isinstance(d, dict):
        raise TagSchemaError("not an object")

    styles = d.get("styles")
    if not isinstance(styles, list) or len(styles) < 1:
        raise TagSchemaError("styles must have at least 1 entry")
    if not all(isinstance(s, str) and s.strip() for s in styles):
        raise TagSchemaError("styles entries must be non-empty strings")
    d["styles"] = dedupe_preserve_order(normalize_tag(s) for s in styles)[:8]

    subject = d.get("subject")
    if not isinstance(subject, str) or not subject.strip():
        raise TagSchemaError("subject must be non-empty string")

    tags = d.get("tags")
    if not isinstance(tags, list) or len(tags) < 3:
        raise TagSchemaError("tags must have at least 3 entries")
    if not all(isinstance(t, str) and t.strip() for t in tags):
        raise TagSchemaError("tags entries must be non-empty strings")
    style_set = set(d["styles"])
    d["tags"] = [
        t
        for t in dedupe_preserve_order(normalize_tag(t) for t in tags)
        if t not in style_set
    ][:12]

    return d


def parse_json_lenient(s: str):
    s = s.strip()
    if s.startswith("```"):
        s = s.strip("`")
        if s.startswith("json"):
            s = s[4:]
        s = s.strip("`").strip()
    i, j = s.find("{"), s.rfind("}")
    if i == -1 or j == -1:
        raise TagSchemaError("no JSON object found in response")
    return json.loads(s[i : j + 1])


# ---------------------------------------------------------------------------
# Production-shaped tagging function
# ---------------------------------------------------------------------------
def tag_image(image_bytes: bytes, mime: str = "image/png", model: str = DEFAULT_MODEL) -> dict:
    """Tag a single image. Returns validated tag dict. Raises on failure.

    Mirrors the production Convex action. Inputs are raw bytes so the
    caller controls fetching from R2; output is the parsed/validated dict
    ready to write to the items table.
    """
    b64 = base64.b64encode(image_bytes).decode("ascii")
    data_url = f"data:{mime};base64,{b64}"

    payload = {
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": PROMPT},
                    {"type": "image_url", "image_url": {"url": data_url}},
                ],
            }
        ],
        "temperature": TEMPERATURE,
        "max_tokens": MAX_TOKENS,
        "response_format": {"type": "json_object"},
        # Reasoning disabled. Empirically (matrix sweep over 4 images × 3
        # trials × 6 treatments) reasoning drifted the model away from
        # specific named-movement labels (swiss, ascii, cyberpunk) toward
        # vaguer descriptors. Reasoning off also produces more stable
        # outputs across re-tags. ~5x cheaper than r1500 baseline.
        # Some models (e.g. google/gemini-3.7-flash) mandate reasoning and
        # 400 on this param; the retry loop drops it for those and marks the
        # result "_reasoning_forced" so comparisons account for it.
        "reasoning": {"enabled": False},
    }

    last_err: Exception | None = None
    for attempt in range(RETRIES + 1):
        try:
            req = urllib.request.Request(
                "https://openrouter.ai/api/v1/chat/completions",
                data=json.dumps(payload).encode("utf-8"),
                headers={
                    "Authorization": f"Bearer {API_KEY}",
                    "Content-Type": "application/json",
                    "HTTP-Referer": "http://localhost/re-collect",
                    "X-Title": "re-collect tag pipeline",
                },
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
                body = json.loads(resp.read().decode("utf-8"))
            content = body["choices"][0]["message"]["content"]
            if not content:
                raise RuntimeError(
                    f"empty content; finish_reason={body['choices'][0].get('finish_reason')}"
                )
            parsed = parse_json_lenient(content)
            validated = validate_tags(parsed)
            # attach usage for the caller (cost telemetry)
            validated["_usage"] = body.get("usage")
            if "reasoning" not in payload:
                validated["_reasoning_forced"] = True
            return validated
        except urllib.error.HTTPError as e:
            detail = ""
            try:
                detail = e.read().decode("utf-8", "replace")
            except Exception:
                pass
            if "Reasoning is mandatory" in detail and "reasoning" in payload:
                del payload["reasoning"]
            last_err = RuntimeError(f"HTTP {e.code}: {detail[:300]}")
        except (urllib.error.URLError, TimeoutError) as e:
            last_err = e
        except (KeyError, json.JSONDecodeError, TagSchemaError, RuntimeError) as e:
            # validation/parse failures are also retryable — temperature > 0
            # means a re-roll might succeed
            last_err = e

        if attempt < RETRIES:
            time.sleep(RETRY_BACKOFF_S[min(attempt, len(RETRY_BACKOFF_S) - 1)])

    raise RuntimeError(f"tag_image failed after {RETRIES + 1} attempts: {last_err}")


# ---------------------------------------------------------------------------
# Experiment harness
# ---------------------------------------------------------------------------
def run_model(model: str, images: list[Path], here: Path) -> None:
    print(f"model: {model}")
    print(f"images ({len(images)}): {[p.name for p in images]}\n")

    def task(img_path: Path):
        original_size = img_path.stat().st_size
        data_url, downscaled_size, mime = downscale_to_data_url(img_path)
        # tag_image expects raw bytes; re-decode the data URL we just built
        b64 = data_url.split(",", 1)[1]
        scaled_bytes = base64.b64decode(b64)
        t0 = time.time()
        try:
            res = tag_image(scaled_bytes, mime, model)
            elapsed = time.time() - t0
            return img_path.name, {
                "ok": True,
                "elapsed_s": round(elapsed, 2),
                "original_bytes": original_size,
                "scaled_bytes": downscaled_size,
                "result": res,
            }
        except Exception as e:
            elapsed = time.time() - t0
            return img_path.name, {
                "ok": False,
                "elapsed_s": round(elapsed, 2),
                "original_bytes": original_size,
                "scaled_bytes": downscaled_size,
                "error": f"{type(e).__name__}: {e}",
            }

    results: dict = {}
    with ThreadPoolExecutor(max_workers=4) as ex:
        for fut in as_completed(ex.submit(task, p) for p in images):
            name, res = fut.result()
            results[name] = res
            if res["ok"]:
                r = res["result"]
                styles = ", ".join(r.get("styles", []))
                shrink = res["original_bytes"] / max(res["scaled_bytes"], 1)
                u = r.get("_usage", {}) or {}
                print(
                    f"[ok]   {name} :: {res['elapsed_s']}s :: "
                    f"{res['original_bytes'] // 1024}KB → {res['scaled_bytes'] // 1024}KB ({shrink:.1f}x) :: "
                    f"in={u.get('prompt_tokens')} out={u.get('completion_tokens')}"
                )
                print(f"       styles: {styles}")
            else:
                print(f"[FAIL] {name} :: {res['elapsed_s']}s :: {res['error'][:200]}")

    slug = model.replace("/", "-").replace(":", "-").replace(".", "")
    out = here / f"results_{slug}.json"
    out.write_text(json.dumps({"model": model, "results": results}, indent=2))
    print(f"\nwrote {out}")


def main():
    here = Path(__file__).parent
    images = sorted(
        p
        for p in here.iterdir()
        if p.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}
    )
    models = sys.argv[1:] or [DEFAULT_MODEL]
    for i, model in enumerate(models):
        if i:
            print("\n" + "=" * 72 + "\n")
        run_model(model, images, here)


if __name__ == "__main__":
    main()
