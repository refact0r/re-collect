#!/usr/bin/env python3
"""
Model bake-off for visual + text tagging (September 2026 round).

Runs a fixed roster of OpenRouter models over frozen inputs:
- visual: every image in this directory (8 as of this round), downscaled
  once and reused byte-identical across models
- text: cached article texts in articles/*.txt (extracted once via
  extract_articles.mjs, mirroring production extraction)

Prompts, params, validation are the production ones (imported from
tag_qwen.py for visual; TEXT_PROMPT below is a byte-for-byte copy of
src/convex/tagging.ts text-v2).

Usage:
    OPENROUTER_API_KEY=sk-or-... python3 compare_models.py [visual|text|all]

Writes results_visual_<slug>.json / results_text_<slug>.json per model.
"""

import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import tag_qwen  # reuses PROMPT, downscale, normalization, validation

HERE = Path(__file__).parent
API_KEY = os.environ["OPENROUTER_API_KEY"]

TEMPERATURE = 0.3
MAX_TOKENS = 600
TIMEOUT_S = 120
RETRIES = 2
RETRY_BACKOFF_S = (2, 5)

MODELS_VISION = [
    "qwen/qwen3.7-flash",  # baseline / shipped default
    "qwen/qwen3.8-flash",
    "z-ai/glm-5.3-flash",
    "minimax/minimax-m3:free",
    "openai/gpt-5.6-luna",
    "openai/gpt-5-nano",
    # thinkingmachines/inkling-small:free was on the roster but 403s on the
    # plain chat API ("only available on agentic harnesses") — excluded.
]

# gpt-5-nano ignores reasoning:{enabled:false} and burns the whole 600-token
# cap on hidden reasoning (empty content, finish_reason=length). Give it
# headroom so we at least get outputs to judge; the deviation is noted in
# the report and is itself a strike against it for this pipeline.
MODEL_OVERRIDES: dict[str, dict] = {
    "openai/gpt-5-nano": {"max_tokens": 4000},
    "z-ai/glm-5.3-flash": {"max_tokens": 2500},  # same hidden-reasoning issue
}

MODELS_TEXT = MODELS_VISION + [
    "deepseek/deepseek-v4-flash",
    "nvidia/nemotron-3-ultra-550b-a55b:free",
    "inclusionai/ling-3.0-flash",
    "upstage/solar-pro4",
]

# Byte-for-byte copy of TEXT_PROMPT (text-v3) in src/convex/tagging.ts.
TEXT_PROMPT = """You are tagging a saved web article for a personal reference library. Based on the article text below, produce genre labels, a summary, and topic tags so the user can rediscover this item later via search.

Return ONLY a JSON object matching this schema. No prose, no markdown fences.

{
  "styles": string[],  // 1-4 high-level genre labels — the form of the piece and the field(s) it belongs to.
  "subject": string,   // one sentence under 30 words — what the article is about.
  "tags": string[]     // 5-12 topic tags, 1-4 words each, lowercase — subjects, technologies, people, places, concepts covered that the user might search for later. Distinct from styles; do not duplicate.
}

Style vocabulary guidance (inspirational, not prescriptive):
- Form: personal essay, tutorial, interview, retrospective, case study, academic paper, documentation, manifesto, review, talk transcript.
- Field: design criticism, typography, software engineering, web design, photography, architecture, career advice.

Rules:
- NEVER use generic labels in styles or tags — no "blog post", "article", "writing", "technology". Pick the specific form and specific topics.
- Include proper nouns (products, companies, people) that are central to the piece, and the author's name if identifiable.
- The article text may be truncated. The subject may describe the piece's overall scope as stated or implied; tags must come only from content actually present."""


def load_pricing() -> dict:
    """Live $/token pricing keyed by model id, for cost telemetry."""
    req = urllib.request.Request("https://openrouter.ai/api/v1/models")
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read())["data"]
    return {
        m["id"]: (
            float(m["pricing"].get("prompt", 0)),
            float(m["pricing"].get("completion", 0)),
        )
        for m in data
    }


PRICING = load_pricing()


def chat(model: str, content) -> tuple[dict, dict]:
    """One tagging chat call. Returns (parsed+validated dict, meta).

    Same request shape and retry semantics as production/tag_qwen: json
    response_format, reasoning disabled; drops `reasoning` then
    `response_format` if a provider 400s on them (recorded in meta).
    """
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": content}],
        "temperature": TEMPERATURE,
        "max_tokens": MAX_TOKENS,
        "response_format": {"type": "json_object"},
        "reasoning": {"enabled": False},
        **MODEL_OVERRIDES.get(model, {}),
    }
    meta = {}
    last_err = None
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
            if "error" in body:  # some providers 200 with an error object
                raise RuntimeError(f"provider error: {json.dumps(body['error'])[:300]}")
            choice = body["choices"][0]
            text = choice["message"]["content"]
            if not text:
                raise RuntimeError(
                    f"empty content; finish_reason={choice.get('finish_reason')}"
                )
            parsed = tag_qwen.parse_json_lenient(text)
            meta["usage"] = body.get("usage")
            meta["provider"] = body.get("provider")
            return parsed, meta
        except urllib.error.HTTPError as e:
            detail = ""
            try:
                detail = e.read().decode("utf-8", "replace")
            except Exception:
                pass
            low = detail.lower()
            if "reasoning" in low and "reasoning" in payload:
                del payload["reasoning"]
                meta["reasoning_forced"] = True
            elif "response_format" in low and "response_format" in payload:
                del payload["response_format"]
                meta["response_format_dropped"] = True
            elif e.code == 429:
                time.sleep(15)
            last_err = RuntimeError(f"HTTP {e.code}: {detail[:300]}")
        except (urllib.error.URLError, TimeoutError) as e:
            last_err = e
        except (KeyError, json.JSONDecodeError, tag_qwen.TagSchemaError, RuntimeError) as e:
            last_err = e
        if attempt < RETRIES:
            time.sleep(RETRY_BACKOFF_S[min(attempt, len(RETRY_BACKOFF_S) - 1)])
    raise RuntimeError(f"chat failed after {RETRIES + 1} attempts: {last_err}")


def validate_text_tags(d: dict) -> dict:
    """Text-mode variant: styles capped at 4 (matches validateTextTags)."""
    out = tag_qwen.validate_tags(dict(d))
    out["styles"] = out["styles"][:4]
    return out


def cost_usd(model: str, usage: dict | None) -> float | None:
    if not usage or model not in PRICING:
        return None
    pin, pout = PRICING[model]
    return usage.get("prompt_tokens", 0) * pin + usage.get("completion_tokens", 0) * pout


def slugify(model: str) -> str:
    return model.replace("/", "-").replace(":", "-").replace(".", "")


def run_track(mode: str, models: list[str], inputs: list[tuple[str, object]]):
    """inputs: list of (name, content) where content is the message content."""
    validate = tag_qwen.validate_tags if mode == "visual" else validate_text_tags
    for mi, model in enumerate(models):
        print(f"\n=== [{mode}] {model} ({mi + 1}/{len(models)}) ===")

        # Fill mode: keep prior successes, only (re)run missing/failed inputs.
        out = HERE / f"results_{mode}_{slugify(model)}.json"
        prior = {}
        if out.exists():
            prior = json.loads(out.read_text()).get("results", {})
        todo = [(n, c) for n, c in inputs if not prior.get(n, {}).get("ok")]
        if not todo:
            print("all inputs already ok; skipping")
            continue

        def task(name, content):
            t0 = time.time()
            try:
                parsed, meta = chat(model, content)
                validated = validate(parsed)
                return name, {
                    "ok": True,
                    "elapsed_s": round(time.time() - t0, 2),
                    "result": validated,
                    "usage": meta.get("usage"),
                    "cost_usd": cost_usd(model, meta.get("usage")),
                    **{k: v for k, v in meta.items() if k not in ("usage", "provider")},
                    "provider": meta.get("provider"),
                }
            except Exception as e:
                return name, {
                    "ok": False,
                    "elapsed_s": round(time.time() - t0, 2),
                    "error": f"{type(e).__name__}: {e}",
                }

        results = {}
        with ThreadPoolExecutor(max_workers=4) as ex:
            futs = [ex.submit(task, n, c) for n, c in todo]
            for fut in as_completed(futs):
                name, res = fut.result()
                results[name] = res
                if res["ok"]:
                    u = res.get("usage") or {}
                    c = res.get("cost_usd")
                    cs = f"${c * 1000:.3f}/1k" if c is not None else "?"
                    print(
                        f"[ok]   {name} :: {res['elapsed_s']}s :: "
                        f"in={u.get('prompt_tokens')} out={u.get('completion_tokens')} :: {cs}"
                    )
                    print(f"       styles: {', '.join(res['result']['styles'])}")
                else:
                    print(f"[FAIL] {name} :: {res['elapsed_s']}s :: {res['error'][:200]}")

        merged = {**prior, **results}
        # prefer a prior ok result over a fresh failure
        for n, r in results.items():
            if not r["ok"] and prior.get(n, {}).get("ok"):
                merged[n] = prior[n]
        ordered = {n: merged[n] for n, _ in inputs if n in merged}
        out.write_text(json.dumps({"model": model, "mode": mode, "results": ordered}, indent=2))
        print(f"wrote {out.name}")


def visual_inputs() -> list[tuple[str, object]]:
    images = sorted(
        p for p in HERE.iterdir() if p.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}
    )
    inputs = []
    for p in images:
        data_url, size, _mime = tag_qwen.downscale_to_data_url(p)
        print(f"prepared {p.name}: {size // 1024}KB scaled")
        inputs.append(
            (
                p.name,
                [
                    {"type": "text", "text": tag_qwen.PROMPT},
                    {"type": "image_url", "image_url": {"url": data_url}},
                ],
            )
        )
    return inputs


def text_inputs() -> list[tuple[str, object]]:
    return [
        (p.stem, f"{TEXT_PROMPT}\n\n{p.read_text()}")
        for p in sorted((HERE / "articles").glob("*.txt"))
    ]


def main():
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    only = sys.argv[2:]  # optional model filter, e.g. `text openai/gpt-5-nano`
    pick = lambda ms: [m for m in ms if not only or m in only]
    if which in ("visual", "all"):
        run_track("visual", pick(MODELS_VISION), visual_inputs())
    if which in ("text", "all"):
        run_track("text", pick(MODELS_TEXT), text_inputs())


if __name__ == "__main__":
    main()
