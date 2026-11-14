# /// script
# requires-python = ">=3.12,<3.14"
# dependencies = ["torch", "transformers>=5", "sentence-transformers[image]>=5", "torchvision", "pillow", "qwen-vl-utils"]
# ///
"""Local Qwen3-VL-Embedding-2B vectors for bench.py (Apache-2.0, top of MMEB-v2 image).

  uv run qwen.py <items.jsonl> <cache_dir>
"""

import json
import sys
import time
from pathlib import Path

import torch
from PIL import Image
from sentence_transformers import SentenceTransformer

sys.path.insert(0, str(Path(__file__).parent))
from bench import QUERIES  # noqa: E402

items_path, cache_dir = sys.argv[1], Path(sys.argv[2])
model = SentenceTransformer("Qwen/Qwen3-VL-Embedding-2B", model_kwargs={"torch_dtype": torch.bfloat16})

items = [json.loads(l) for l in open(items_path)]
ids = [it["_id"] for it in items if (cache_dir / "img" / f"{it['_id']}.jpg").exists()]

vecs, lat = [], []
for i in ids:
    t = time.perf_counter()
    im = Image.open(cache_dir / "img" / f"{i}.jpg").convert("RGB")
    vecs.append(model.encode([{"image": im}])[0].tolist())
    lat.append(time.perf_counter() - t)
q, qlat = [], []
for text in QUERIES:
    t = time.perf_counter()
    q.append(model.encode([text], prompt="Retrieve images that match the description.")[0].tolist())
    qlat.append(time.perf_counter() - t)

json.dump(
    {"ids": ids, "vecs": vecs, "lat": lat, "cost": 0, "queries": q, "qlat": qlat},
    open(cache_dir / "local-qwen3-vl-embedding-2b.json", "w"),
)
print("qwen3-vl-embedding-2b", len(ids), f"median {sorted(lat)[len(lat) // 2]:.3f}s/img")
