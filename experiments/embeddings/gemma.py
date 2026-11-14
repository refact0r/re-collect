# /// script
# requires-python = ">=3.12,<3.14"
# dependencies = ["torch", "transformers>=5", "sentence-transformers[image]>=5", "torchvision", "pillow"]
# ///
"""Local EmbeddingGemma 2 vectors for bench.py (open weights; DeepInfra hosts it).

  uv run gemma.py <items.jsonl> <cache_dir>
"""

import json
import sys
import time
from pathlib import Path

from PIL import Image
from sentence_transformers import SentenceTransformer

sys.path.insert(0, str(Path(__file__).parent))
from bench import QUERIES  # noqa: E402

items_path, cache_dir = sys.argv[1], Path(sys.argv[2])
model = SentenceTransformer("google/embeddinggemma-2")

items = [json.loads(l) for l in open(items_path)]
ids = [it["_id"] for it in items if (cache_dir / "img" / f"{it['_id']}.jpg").exists()]

vecs, lat = [], []
for i in ids:
    t = time.perf_counter()
    im = Image.open(cache_dir / "img" / f"{i}.jpg").convert("RGB")
    vecs.append(model.encode({"image": im}, prompt_name="Document").tolist())
    lat.append(time.perf_counter() - t)
q, qlat = [], []
for text in QUERIES:
    t = time.perf_counter()
    q.append(model.encode(text, prompt_name="SearchQuery").tolist())
    qlat.append(time.perf_counter() - t)

json.dump(
    {"ids": ids, "vecs": vecs, "lat": lat, "cost": 0, "queries": q, "qlat": qlat},
    open(cache_dir / "local-embeddinggemma-2.json", "w"),
)
print("embeddinggemma-2", len(ids), f"median {sorted(lat)[len(lat) // 2]:.3f}s/img")
