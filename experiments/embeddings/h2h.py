# /// script
# requires-python = ">=3.12"
# dependencies = ["numpy", "pillow"]
# ///
"""Blind head-to-head of two cached models from bench.py (item->item and text->image).

  uv run h2h.py sheets <items.jsonl> <cache_dir> <model_a> <model_b>
  uv run h2h.py tally  <cache_dir> <verdicts.json>

`sheets` writes contact sheets with the two models shuffled into rows X/Y per
seed, plus key.json (which model each X/Y is). Judge the sheets without
reading the key, write {"n000": "X" | "Y" | "=" , "q00": ...} to verdicts.json,
then `tally` unblinds.
"""

import json
import random
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

K = 5
TW, TH = 200, 140
SEEDS_PER_SHEET = 3


def load(cache: Path, name: str, ids: list[str]):
    d = json.load(open(cache / f"{name}.json"))
    pos = {i: k for k, i in enumerate(d["ids"])}
    X = np.array([d["vecs"][pos[i]] for i in ids], dtype=np.float32)
    Q = np.array(d["queries"], dtype=np.float32)
    return X / np.linalg.norm(X, axis=1, keepdims=True), Q / np.linalg.norm(Q, axis=1, keepdims=True)


def thumb(cache: Path, i: str) -> Image.Image:
    im = Image.open(cache / "img" / f"{i}.jpg")
    im.thumbnail((TW - 6, TH - 6))
    return im


def block(cache: Path, title: str, seed: str | None, rows: list[tuple[str, list[str]]]) -> Image.Image:
    lead = 1 if seed else 0
    w = 40 + TW * (lead + K)
    out = Image.new("RGB", (w, 22 + TH * len(rows)), "white")
    d = ImageDraw.Draw(out)
    d.text((6, 4), title, fill="black")
    for r, (label, ids) in enumerate(rows):
        y = 22 + r * TH
        d.text((10, y + TH // 2), label, fill="black")
        if seed:
            out.paste(thumb(cache, seed), (40, y))
            d.rectangle((40, y, 40 + TW - 6, y + TH - 6), outline="red", width=3)
        for c, i in enumerate(ids):
            out.paste(thumb(cache, i), (40 + TW * (lead + c), y))
    return out


def stack(blocks: list[Image.Image], path: Path) -> None:
    w = max(b.width for b in blocks)
    out = Image.new("RGB", (w, sum(b.height for b in blocks) + 12 * len(blocks)), (200, 200, 200))
    y = 0
    for b in blocks:
        out.paste(b, (0, y))
        y += b.height + 12
    out.save(path, quality=80)


def sheets(items_path: str, cache_dir: str, a: str, b: str) -> None:
    sys.path.insert(0, str(Path(__file__).parent))
    from bench import QUERIES

    cache = Path(cache_dir)
    items = [json.loads(l) for l in open(items_path)]
    ids = [it["_id"] for it in items if (cache / "img" / f"{it['_id']}.jpg").exists()]
    XA, QA = load(cache, a, ids)
    XB, QB = load(cache, b, ids)
    rng = random.Random(7)
    out = cache / "h2h"
    out.mkdir(exist_ok=True)
    key, blocks, overlap = {}, [], []

    def top(X, v, exclude=None):
        s = X @ v
        if exclude is not None:
            s[exclude] = -np.inf
        return [ids[t] for t in np.argsort(-s)[:K]]

    for n, seed in enumerate(ids):
        na, nb = top(XA, XA[n], n), top(XB, XB[n], n)
        overlap.append(len(set(na) & set(nb)))
        flip = rng.random() < 0.5
        key[f"n{n:03d}"] = {"X": b if flip else a, "Y": a if flip else b, "same": set(na) == set(nb)}
        rows = [("X", nb if flip else na), ("Y", na if flip else nb)]
        blocks.append(block(cache, f"n{n:03d}  (red = seed; which row is more similar?)", seed, rows))
    for s in range(0, len(blocks), SEEDS_PER_SHEET):
        stack(blocks[s : s + SEEDS_PER_SHEET], out / f"items_{s // SEEDS_PER_SHEET:02d}.jpg")

    blocks = []
    for qi, q in enumerate(QUERIES):
        flip = rng.random() < 0.5
        ra, rb = top(XA, QA[qi]), top(XB, QB[qi])
        key[f"q{qi:02d}"] = {"X": b if flip else a, "Y": a if flip else b, "same": ra == rb}
        rows = [("X", rb if flip else ra), ("Y", ra if flip else rb)]
        blocks.append(block(cache, f"q{qi:02d}  {q}", None, rows))
    for s in range(0, len(blocks), SEEDS_PER_SHEET + 1):
        stack(blocks[s : s + SEEDS_PER_SHEET + 1], out / f"queries_{s // (SEEDS_PER_SHEET + 1):02d}.jpg")

    json.dump(key, open(out / "key.json", "w"), indent=1)
    print(f"{len(ids)} seeds, {len(QUERIES)} queries; mean top-{K} overlap {np.mean(overlap):.2f}/{K}; "
          f"identical sets {sum(o == K for o in overlap)}")


def tally(cache_dir: str, verdicts_path: str) -> None:
    key = json.load(open(Path(cache_dir) / "h2h" / "key.json"))
    verdicts = json.load(open(verdicts_path))
    for kind, prefix in (("item->item", "n"), ("text->image", "q")):
        wins: dict[str, int] = {}
        for k, v in verdicts.items():
            if not k.startswith(prefix):
                continue
            winner = "tie" if v == "=" else key[k][v]
            wins[winner] = wins.get(winner, 0) + 1
        print(kind, wins)


if __name__ == "__main__":
    {"sheets": sheets, "tally": tally}[sys.argv[1]](*sys.argv[2:])
