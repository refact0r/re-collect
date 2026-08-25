# Model comparison — August 2026

Bake-off over the 4 sample images in this directory (`python3 tag_qwen.py
<model> ...`, full outputs in `results_*.json`). Candidates vs the shipped
default `qwen/qwen3.6-flash:v4`. Prompt/params identical everywhere except
where noted. **Outcome: `qwen/qwen3.7-flash` adopted as `DEFAULT_MODEL` on
2026-08-25.**

| Model | $/1M in/out | out tok/img | Notes |
| --- | --- | --- | --- |
| qwen/qwen3.6-flash (previous default) | 0.19 / 1.13 | ~165 | Baseline. OCR miss: read "soft space" as "sofi space". |
| **qwen/qwen3.7-flash** | **0.03 / 0.13** | ~185 | Direct successor, ~7× cheaper. Fixed the "sofi" OCR error, richer/more specific tags ("day 127 year 31", "masked character"). Style stability across re-runs: 2/4 identical, 1/4 same labels reworded, 1/4 synonym wobble on an ambiguous book cover. |
| google/gemini-3.7-flash | 0.375 / 1.88 | ~480 | **Reasoning is mandatory** — rejects `reasoning: {enabled: false}` with a 400; the sandbox auto-drops the param and marks `_reasoning_forced`. Best OCR (extracted actual hanzi 孙频), strong compositional tags ("cantilever stair", "megastructure"), but shows the known reasoning drift toward vaguer style labels ("contemporary graphic", "modern typography") and missed low-poly/ps1 on img3. ~3× output tokens from billed reasoning; ~25× the cost of qwen3.7-flash. |
| qwen/qwen3.8-27b | 0.35 / 2.75 | ~135 | Weakest. Hallucinated ("map of africa" on the book cover), garbled OCR ("concrete soudute", "kedujian"), missed the img4 headline entirely. No flash tier exists in the 3.8 family yet. |

## Verdict

`qwen/qwen3.7-flash`: equal-or-better tags than the shipped 3.6-flash at ~7×
lower cost, honors `reasoning: {enabled: false}`, and drops in with zero
prompt changes. Gemini's OCR edge doesn't justify 25× the cost plus
mandatory reasoning (which contradicts the sweep that fixed reasoning-off in
the first place).

To trial on a live deployment without a code change:
`npx convex env set TAGGING_MODEL qwen/qwen3.7-flash`, retag a few items,
compare (`taggingModelVersion` records the model per item). To adopt: flip
`DEFAULT_MODEL` here and in `src/convex/tagging.ts`. `PROMPT_VERSION` stays
`v4` — the prompt is unchanged.
