# /// script
# requires-python = ">=3.12,<3.14"
# dependencies = ["torch", "transformers>=4.50", "pillow", "sentencepiece", "protobuf"]
# ///
"""Local SigLIP 2 vectors for bench.py, standing in for a self-hosted CLIP-family model.

  uv run siglip.py <items.jsonl> <cache_dir> [model_id]

Run after `bench.py embed` so the 1024px JPEGs are already in <cache_dir>/img.
"""

import json
import sys
import time
from pathlib import Path

import torch
from PIL import Image
from transformers import AutoModel, AutoProcessor

sys.path.insert(0, str(Path(__file__).parent))
from bench import QUERIES  # noqa: E402

items_path, cache_dir = sys.argv[1], Path(sys.argv[2])
model_id = sys.argv[3] if len(sys.argv) > 3 else "google/siglip2-base-patch16-256"
device = "mps" if torch.backends.mps.is_available() else "cpu"

def features(out):
    # transformers 5 returns a ModelOutput; its pooler_output is the projected embedding
    t = out if isinstance(out, torch.Tensor) else out.pooler_output
    return t[0].float().cpu().tolist()


model = AutoModel.from_pretrained(model_id).to(device).eval()
proc = AutoProcessor.from_pretrained(model_id)

items = [json.loads(l) for l in open(items_path)]
ids = [it["_id"] for it in items if (cache_dir / "img" / f"{it['_id']}.jpg").exists()]

vecs, lat = [], []
with torch.no_grad():
    for i in ids:
        t = time.perf_counter()
        im = Image.open(cache_dir / "img" / f"{i}.jpg").convert("RGB")
        x = proc(images=im, return_tensors="pt").to(device)
        vecs.append(features(model.get_image_features(**x)))
        lat.append(time.perf_counter() - t)
    q, qlat = [], []
    for text in QUERIES:
        t = time.perf_counter()
        x = proc(text=[text.lower()], padding="max_length", max_length=64, return_tensors="pt").to(device)
        q.append(features(model.get_text_features(**x)))
        qlat.append(time.perf_counter() - t)

name = "local-" + model_id.split("/")[-1]
json.dump(
    {"ids": ids, "vecs": vecs, "lat": lat, "cost": 0, "queries": q, "qlat": qlat},
    open(cache_dir / f"{name}.json", "w"),
)
print(name, len(ids), f"median {sorted(lat)[len(lat) // 2]:.3f}s/img on {device}")
