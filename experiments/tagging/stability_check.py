#!/usr/bin/env python3
"""Re-run finalists on a subset of images to measure style stability across
re-tags (same criterion as the August bake-off). Writes stability_<slug>.json
with N trials per image.

Usage: OPENROUTER_API_KEY=... python3 stability_check.py <model> [trials]
"""

import json
import sys
from pathlib import Path

import tag_qwen
import compare_models as cm

HERE = Path(__file__).parent
IMAGES = [
    "11cb983c-234b-4dbd-8d75-9d52a60ebef3.png",
    "2be91ec1-de91-4a44-ae34-cebb090f3d3a.png",
    "bbf2a4de-f0f1-4d7d-8fe4-814f919250c6.png",
    "j970dmwy4f59mtvhx82z9gvt957zet99-1768699057177.webp",
]

model = sys.argv[1]
trials = int(sys.argv[2]) if len(sys.argv) > 2 else 2

out = {}
for name in IMAGES:
    data_url, _, _ = tag_qwen.downscale_to_data_url(HERE / name)
    content = [
        {"type": "text", "text": tag_qwen.PROMPT},
        {"type": "image_url", "image_url": {"url": data_url}},
    ]
    runs = []
    for t in range(trials):
        try:
            parsed, _meta = cm.chat(model, content)
            runs.append(tag_qwen.validate_tags(parsed)["styles"])
        except Exception as e:
            runs.append({"error": str(e)[:150]})
        print(f"{name} trial {t + 1}: {runs[-1]}")
    out[name] = runs

slug = cm.slugify(model)
(HERE / f"stability_{slug}.json").write_text(json.dumps({"model": model, "runs": out}, indent=2))
