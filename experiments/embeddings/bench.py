# /// script
# requires-python = ">=3.12"
# dependencies = ["numpy", "pillow"]
# ///
"""Throwaway embedding benchmark for reference/embeddings-research.md.

Embeds every library item (exported with `npx convex data items --format jsonLines`)
with several models, then reports latency, cost, a tag-agreement proxy for
neighbour quality, cross-model agreement and text->image query hits.

  uv run bench.py embed  <items.jsonl> <cache_dir>    # API models (OpenRouter)
  uv run bench.py report <items.jsonl> <cache_dir>    # metrics + contact sheets

Needs OPENROUTER_API_KEY and R2_PUBLIC_URL in the environment. Local SigLIP 2
vectors come from siglip.py (separate deps) and land in the same cache dir.
"""

import base64
import io
import json
import os
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image

API = "https://openrouter.ai/api/v1/embeddings"
MAX_EDGE = 1024  # matches preprocessItem

# name -> (openrouter model id, image transport, extra body)
IMAGE_MODELS = {
    "voyage-mm-3.5": ("mongodb/voyage-multimodal-3.5", "b64", {}),
    "cohere-embed-5-fast": ("cohere/embed-5-fast", "b64", {}),
    "gemini-embedding-2": ("google/gemini-embedding-2", "b64", {}),
}
# Text-only baseline over the LLM tagger output (subject + styles + aiTags)
TAGTEXT_MODELS = {
    "tagtext-3-small": "openai/text-embedding-3-small",
    "tagtext-voyage-mm": "mongodb/voyage-multimodal-3.5",  # same space as its images
    "tagtext-gemini-2": "google/gemini-embedding-2",
}


def derive(cache: Path) -> None:
    """Variants computed from cached vectors: MRL truncation and image+text fusion."""
    def load(n):
        return json.load(open(cache / f"{n}.json"))

    g = load("gemini-embedding-2")
    for dims in (768, 256):
        json.dump({**g, "vecs": [v[:dims] for v in g["vecs"]], "queries": [q[:dims] for q in g["queries"]]},
                  open(cache / f"derived-gemini-{dims}.json", "w"))
    for img, txt in (("gemini-embedding-2", "tagtext-gemini-2"), ("voyage-mm-3.5", "tagtext-voyage-mm")):
        a, b = load(img), load(txt)
        bi = {i: k for k, i in enumerate(b["ids"])}
        fused = [list(unit(np.array([v]))[0] + unit(np.array([b["vecs"][bi[i]]]))[0]) for i, v in zip(a["ids"], a["vecs"])]
        json.dump({**a, "vecs": [list(map(float, f)) for f in fused], "cost": a["cost"] + b["cost"]},
                  open(cache / f"derived-fused-{img}.json", "w"))

QUERIES = [
    "dark brutalist website with monospace type",
    "swiss international typographic poster",
    "terminal style developer portfolio",
    "editorial website with big serif headlines",
    "glitchy experimental digital art",
    "minimal white portfolio with lots of whitespace",
    "map or data visualization",
    "hand-drawn illustration",
    "photo of a physical object",
    "warm retro-futurist computer aesthetic",
    "black background with oversized white type",
    "pastel colors and soft gradients",
    "collage of cut-out paper and photos",
    "pixel art",
    "halftone print texture",
    "3D rendered abstract shapes",
    "cream background with serif type, calm and literary",
    "busy maximalist layout with lots of stickers",
    "grid of project thumbnails",
    "looks like an old operating system",
    "neon green accents",
    "blueprint or technical drawing",
    "orange and black",
    "dotted grid background",
    "landing page for an AI company",
    "personal blog that is mostly text",
    "surreal character illustration",
    "corporate fintech website",
    "experimental type poster with distorted letters",
    "photo of people",
]


def post(body: dict) -> tuple[dict, float]:
    req = urllib.request.Request(
        API,
        data=json.dumps(body).encode(),
        headers={
            "Authorization": f"Bearer {os.environ['OPENROUTER_API_KEY']}",
            "Content-Type": "application/json",
        },
    )
    t = time.perf_counter()
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r), time.perf_counter() - t
        except Exception as e:  # noqa: BLE001
            if attempt == 2:
                raise
            print("retry", e, file=sys.stderr)
            time.sleep(2)
    raise RuntimeError


def load_items(path: str) -> list[dict]:
    rows = [json.loads(l) for l in open(path)]
    return [r for r in rows if r.get("imageKey")]


def jpeg_1024(item: dict, cache: Path) -> bytes:
    """Fetch from R2 and downscale like preprocessItem (1024px max edge, JPEG q85)."""
    p = cache / "img" / f"{item['_id']}.jpg"
    if p.exists():
        return p.read_bytes()
    url = f"{os.environ['R2_PUBLIC_URL']}/{item['imageKey']}"
    req = urllib.request.Request(url, headers={"User-Agent": "re-collect-bench/1"})
    with urllib.request.urlopen(req, timeout=60) as r:
        im = Image.open(io.BytesIO(r.read()))
    im = im.convert("RGB")
    im.thumbnail((MAX_EDGE, MAX_EDGE))
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=85)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(buf.getvalue())
    return buf.getvalue()


def tag_text(item: dict) -> str:
    parts = [item.get("title") or "", item.get("subject") or ""]
    if item.get("styles"):
        parts.append("Styles: " + ", ".join(item["styles"]))
    if item.get("aiTags"):
        parts.append("Tags: " + ", ".join(item["aiTags"]))
    return ". ".join(p for p in parts if p) or item.get("url") or "untitled"


def embed(items_path: str, cache_dir: str) -> None:
    cache = Path(cache_dir)
    items = load_items(items_path)
    with ThreadPoolExecutor(8) as ex:
        list(ex.map(lambda it: jpeg_1024(it, cache), items))

    for name, (model, _, extra) in IMAGE_MODELS.items():
        out = cache / f"{name}.json"
        if out.exists():
            continue

        def one(it):
            b64 = base64.b64encode(jpeg_1024(it, cache)).decode()
            body = {
                "model": model,
                "input": [{"content": [{"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}}]}],
                **extra,
            }
            d, dt = post(body)
            return it["_id"], d["data"][0]["embedding"], dt, d["usage"].get("cost", 0)

        with ThreadPoolExecutor(4) as ex:
            res = list(ex.map(one, items))
        q, qdt = [], []
        for text in QUERIES:  # one call per query to measure query latency
            d, dt = post({"model": model, "input": [text], **extra})
            q.append(d["data"][0]["embedding"])
            qdt.append(dt)
        json.dump(
            {
                "ids": [r[0] for r in res],
                "vecs": [r[1] for r in res],
                "lat": [r[2] for r in res],
                "cost": sum(r[3] for r in res),
                "queries": q,
                "qlat": qdt,
            },
            open(out, "w"),
        )
        print(name, "done", f"${sum(r[3] for r in res):.4f}", f"median {np.median([r[2] for r in res]):.2f}s")

    for name, model in TAGTEXT_MODELS.items():
        out = cache / f"{name}.json"
        if out.exists():
            continue
        texts = [tag_text(it) for it in items]
        d, dt = post({"model": model, "input": texts})
        qd, qdt = post({"model": model, "input": QUERIES})
        json.dump(
            {
                "ids": [it["_id"] for it in items],
                "vecs": [e["embedding"] for e in d["data"]],
                "lat": [dt / len(items)] * len(items),
                "cost": d["usage"].get("cost", 0) + qd["usage"].get("cost", 0),
                "queries": [e["embedding"] for e in qd["data"]],
                "qlat": [qdt / len(QUERIES)] * len(QUERIES),
            },
            open(out, "w"),
        )
        print(name, "done")
    derive(cache)


def unit(m: np.ndarray) -> np.ndarray:
    return m / np.linalg.norm(m, axis=1, keepdims=True)


def labels(item: dict) -> set[str]:
    return set(item.get("styles", [])) | set(item.get("aiTags", []))


def report(items_path: str, cache_dir: str) -> None:
    cache = Path(cache_dir)
    items = {it["_id"]: it for it in load_items(items_path)}
    models = {}
    for f in sorted(cache.glob("*.json")):
        d = json.load(open(f))
        if "vecs" not in d:
            continue
        order = [i for i in d["ids"] if i in items]
        idx = {i: k for k, i in enumerate(d["ids"])}
        models[f.stem] = {
            "ids": order,
            "X": unit(np.array([d["vecs"][idx[i]] for i in order], dtype=np.float32)),
            "Q": unit(np.array(d["queries"], dtype=np.float32)),
            "lat": d["lat"],
            "qlat": d["qlat"],
            "cost": d["cost"],
        }

    ids = sorted(set.intersection(*(set(m["ids"]) for m in models.values())))
    tagged = [i for i in ids if labels(items[i])]
    K = 5

    # Random-neighbour baseline for the tag-agreement proxy
    rng = np.random.default_rng(0)
    base = []
    for i in tagged:
        others = rng.choice([j for j in tagged if j != i], K, replace=False)
        base.append(np.mean([jacc(labels(items[i]), labels(items[j])) for j in others]))
    print(f"items={len(ids)} tagged={len(tagged)} random-baseline tag-jaccard@{K}={np.mean(base):.3f}\n")

    nbrs = {}
    print(f"{'model':24} {'dims':>5} {'cost':>8} {'img p50':>8} {'q p50':>6} {'jacc@5':>7} {'same-type@5':>11} {'sim spread':>10}")
    for name, m in models.items():
        pos = {i: k for k, i in enumerate(m["ids"])}
        X = m["X"][[pos[i] for i in ids]]
        S = X @ X.T
        np.fill_diagonal(S, -np.inf)
        top = np.argsort(-S, axis=1)[:, :K]
        nbrs[name] = top
        j = [np.mean([jacc(labels(items[ids[a]]), labels(items[ids[b]])) for b in top[a]]) for a in range(len(ids)) if ids[a] in tagged]
        same = np.mean([np.mean([items[ids[a]]["type"] == items[ids[b]]["type"] for b in top[a]]) for a in range(len(ids))])
        off = S[np.isfinite(S)]
        print(f"{name:24} {m['X'].shape[1]:5d} ${m['cost']:7.4f} {np.median(m['lat']):7.2f}s {np.median(m['qlat']):5.2f}s {np.mean(j):7.3f} {same:11.2f} {np.percentile(off, 95) - np.percentile(off, 5):10.3f}")

    print("\nTop-5 neighbour overlap between models (mean |A∩B|/5):")
    names = list(models)
    print(" " * 24 + "".join(f"{n[:10]:>11}" for n in names))
    for a in names:
        row = [np.mean([len(set(nbrs[a][r]) & set(nbrs[b][r])) / K for r in range(len(ids))]) for b in names]
        print(f"{a:24}" + "".join(f"{v:11.2f}" for v in row))

    sheets = cache / "sheets"
    sheets.mkdir(exist_ok=True)
    # Item->item: seed in column 0, its top-4 neighbours after it
    for s in range(0, len(ids), max(1, len(ids) // 8)):
        rows = [(name, [ids[s]] + [ids[b] for b in nbrs[name][s][:4]]) for name in models]
        contact_sheet(rows, cache, sheets / f"n{s:02d}.jpg", f"neighbours of {ids[s]}", cols=5)
    print("\nText->image queries, top-4 subjects per model:")
    for qi, q in enumerate(QUERIES):
        print(f"\n## {q}")
        rows = []
        for name, m in models.items():
            pos = {i: k for k, i in enumerate(m["ids"])}
            X = m["X"][[pos[i] for i in ids]]
            s = X @ m["Q"][qi]
            top = np.argsort(-s)[:4]
            rows.append((name, [ids[t] for t in top]))
            print(f"  {name:22} " + " | ".join((items[ids[t]].get("subject") or items[ids[t]].get("title") or "")[:38] for t in top))
        contact_sheet(rows, cache, sheets / f"q{qi:02d}.jpg", q)


def jacc(a: set, b: set) -> float:
    return len(a & b) / len(a | b) if a | b else 0.0


def contact_sheet(rows, cache: Path, out: Path, title: str, cols: int = 4) -> None:
    from PIL import ImageDraw

    tw, th, lw = 220, 160, 170
    sheet = Image.new("RGB", (lw + tw * cols, 24 + th * len(rows)), "white")
    d = ImageDraw.Draw(sheet)
    d.text((6, 6), title, fill="black")
    for r, (name, ids) in enumerate(rows):
        d.text((6, 24 + r * th + th // 2), name, fill="black")
        for c, i in enumerate(ids):
            im = Image.open(cache / "img" / f"{i}.jpg")
            im.thumbnail((tw - 6, th - 6))
            sheet.paste(im, (lw + c * tw, 24 + r * th))
    sheet.save(out, quality=80)


if __name__ == "__main__":
    {"embed": embed, "report": report}[sys.argv[1]](*sys.argv[2:])
