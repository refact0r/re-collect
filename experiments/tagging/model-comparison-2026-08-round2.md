# Model comparison round 2 — August 2026 (visual + text tagging)

**Outcome: `openai/gpt-5.6-luna` adopted as `DEFAULT_MODEL` for both tagging
modes on 2026-08-28** (plus: retry loop added to production, `normalizeTag`
now singularizes only the head noun — see Side findings).

Bake-off over frozen inputs: **8 images** (the 4 round-1 samples + 4 pulled
from the dev deployment: fish collage, riso tritone charts photo, Making
Software isometric page, Fiddle.Digital site) and **6 articles** (the 3
text-tagged dev items — olivine weathering, syntax highlighting, JPEG
compression — plus How to Do Great Work, Keyboard Latency, The Good Room).
Articles extracted once via `extract_articles.mjs` (same Defuddle path and
caps as production) and cached in `articles/`, so every model saw
byte-identical input. Harness: `compare_models.py`; per-model outputs in
`results_{visual,text}_<slug>.json`; stability re-runs in
`stability_<slug>.json`.

Prompts/params identical to production (`v4` visual, `text-v2` text, temp
0.3, `max_tokens` 600, `reasoning: {enabled: false}`) except where noted.
Budget target: ≤ ~$0.2/M in, ~$1/M out (baseline `qwen/qwen3.7-flash` is
0.03/0.13).

## Results

$/1k items computed from actual token usage at current OpenRouter pricing
(`*` = free tier used; cost shown at the paid twin's rate). Latency inflated
for models that needed retries.

### Visual (8 images)

| Model | $/M in/out | ok | out tok | lat | $/1k items | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| qwen/qwen3.7-flash (default) | 0.03/0.13 | 8/8 | 177 | 6.5s | $0.065 | Solid all-round, cheapest, complete. Occasionally vaguer styles ("contemporary graphic", "digital surrealism") and soft OCR garbles ("odotype"). |
| **openai/gpt-5.6-luna** | 0.20/1.20 | 8/8 | 123 | 2.8s | $0.450 | **Best visual quality.** Most accurate style calls (ps2/low-poly on the game menu, brutalist web, constructivist on the book cover), best search anchors ("welcome to our soft space", "day 127", "terra a26"). Fastest. One garble ("rencan" for Renjian). |
| z-ai/glm-5.3-flash | 0.075/0.25 | 8/8 | 726 | 12.4s | $0.306 | Quality rivals luna — richest concrete tags (client names off Fiddle.Digital, "small pink door illustration", "start button"). But ignores `reasoning: {enabled: false}` on ~half of calls: hidden reasoning blows the 600-token cap (empty content) until `max_tokens` ≥ ~2500. Would need a prod config change + slower + wobblier styles. |
| minimax/minimax-m3:free | free (0.30/1.20) | 8/8 | 116 | 5.8s | $0.668* | Decent but error-prone at detail level: "room code g8" (it's G6), "graph room, tapei taiwan", invented "page 41-42". Free tier fine for experiments, not a prod dependency. |
| qwen/qwen3.8-flash | 0.15/0.47 | 8/8 | 150 | 24.9s | $0.278 | Two disqualifiers: (1) upstream rate-limited for hours — took 5 runs over ~40 min to complete 8 images; (2) same hallucination family as its 27b sibling from round 1: "fragmented map of the United States", "rainbow trout", "dna sequence" on the fish collage, and the round-1 "sofi space" OCR error is back. |
| openai/gpt-5-nano | 0.05/0.40 | 8/8 | 2698 | 30.6s | $1.167 | Ignores reasoning-off; burned 2–3.5k hidden reasoning tokens per image (needed `max_tokens` 4000 to answer at all — would hard-fail under prod's 600 cap). Weakest OCR of the completers. |
| thinkingmachines/inkling-small:free | free | 0/8 | — | — | — | 403 on the plain chat API: "only available on agentic harnesses". Unusable. |

### Text (6 articles)

| Model | $/M in/out | ok | out tok | lat | $/1k items | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| qwen/qwen3.7-flash (default) | 0.03/0.13 | 6/6 | 142 | 2.1s | $0.082 | Good; styles slightly generic ("technical analysis", "science journalism") but tags rich and accurate. |
| **openai/gpt-5.6-luna** | 0.20/1.20 | 6/6 | 103 | 3.1s | $0.529 | **Best text quality.** Sharpest form labels ("benchmarking report", "talk transcript"), caught deep-cut concepts (oklab, kernel matrix), clean concise subjects. |
| **upstage/solar-pro4** | 0.03/0.12 | 6/6 | 134 | 4.7s | $0.079 | Sleeper hit at baseline price. Specific styles ("science journalism, climate technology, geochemistry"), dense proper-noun tags (alexander cassatt, haber-bosch, 1pointfive). Slightly list-happy (always 4 styles). Text-only. |
| z-ai/glm-5.3-flash | 0.075/0.25 | 6/6 | 579 | 20.8s | $0.300 | Best *subjects* of anyone ("keypress-to-USB latency… gaming keyboards aren't faster despite marketing"). Same hidden-reasoning caveat as visual. |
| deepseek/deepseek-v4-flash | 0.089/0.177 | 6/6 | 96 | 2.9s | $0.201 | Good and fast; styles a bit generic ("essay" where the prompt asks for the specific form). Text-only (vision variant is 0.44/1.32, over budget, not tested). |
| nvidia/nemotron-3-ultra-550b-a55b:free | free (0.50/2.20) | 6/6 | 110 | 4.8s | $1.295* | Strong, concise output — but the free endpoint 502'd repeatedly (took 3 passes to complete 6 articles), and the paid twin is over budget. |
| minimax/minimax-m3:free | free (0.30/1.20) | 6/6 | 100 | 7.1s | $0.768* | Strong text quality, better than its visual showing. |
| qwen/qwen3.8-flash | 0.15/0.47 | 6/6 | 140 | 61.3s | $0.384 | Text quality is genuinely good ("benchmark report", "signal processing") — but see availability disaster above. |
| inclusionai/ling-3.0-flash | 0.021/0.063 | 5/6 | 136 | 18.8s | $0.054 | Deterministic schema failure on the JPEG article (empty `styles`, 3 runs in a row) — fatal given prod has no retry. Also mislabels ("personal essay" for a hardware benchmark) and 40+ word subjects. |
| openai/gpt-5-nano | 0.05/0.40 | 6/6 | 1903 | 27.1s | $0.863 | Reasoning burn again, plus ugly machine-y tags ("chroma_subsampling", "keyboard-latency"). |

## Stability (2 re-runs × 4 images: luna / qwen3.7-flash / glm-5.3-flash)

All three are comparable: core styles stable, tail-end synonym wobble
("liminal space"↔"liminal", "retrowave"↔"retro-futurist"), and everyone
wobbles most on the ambiguous book cover — same as round 1. Luna and glm
consistently identify the caeruleum image as ps2-era/video-game (it *is* a
game menu mock), where qwen3.7-flash says vaporwave/retrowave. glm's labels
run wordier ("contemporary chinese book cover", "graphic color blocking"),
which adds variance.

## Verdict

- **Value pick / status quo: `qwen/qwen3.7-flash`.** Nothing at or near its
  price beats it on either track. If cost parity is the constraint, keep it
  for both modes and close the book.
- **Quality pick: `openai/gpt-5.6-luna` for both tracks.** The only model
  that beat the baseline on *both* visual and text quality while staying
  inside budget (0.20/1.20). Fastest model tested, honors reasoning-off,
  stable across re-runs, one model for both modes. ~7× the baseline's cost
  but absolute numbers are trivial for a single-user library: ~$0.45–0.55
  per 1,000 items tagged vs ~$0.07.
- **If splitting tracks were free:** solar-pro4 matches baseline pricing
  with better text styles, but the gain over luna/qwen isn't worth running
  a second model. Not adopted.
- glm-5.3-flash is the interesting near-miss: luna-level quality at ¼ the
  price, but it needs `max_tokens` raised ~4× to survive its own hidden
  reasoning, is 4× slower, and that reasoning behavior contradicts the
  round-1 finding that reasoning hurts this task.

To trial without a code change: `npx convex env set TAGGING_MODEL
openai/gpt-5.6-luna`, retag a few items, compare
(`taggingModelVersion` records the model per item). To adopt: flip
`DEFAULT_MODEL` in `src/convex/tagging.ts` and `tag_qwen.py`. Prompt
versions stay `v4`/`text-v2` — prompts unchanged.

## Side findings (not model choice, worth fixing)

- **`normalizeTag` singularizes proper nouns**: "Substans" (conference) →
  "substan", "Climeworks" → "climework", "beaux-arts" → "beaux-art",
  chipping search anchors across every model. `KEEP_PLURAL` doesn't scale;
  consider only singularizing known-common words, or skipping
  singularization for capitalized/multi-token proper nouns.
- **Production has no retry** (`tagging.ts` calls OpenRouter once; only the
  sandbox retries). Any model with schema flakiness (ling) or reasoning
  burn (glm, gpt-5-nano) fails much harder in prod than in this harness —
  and even good models occasionally 429/502. A single scheduled retry on
  failure would derisk any choice.
