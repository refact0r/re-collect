# AI Tagging — Implementation Architecture (as built)

Describes the shipped tagging pipeline. Companion to `design.md` (product
framing) and `tag_qwen.py` (canonical source of the visual prompt, model
params, and validation logic — production in `src/convex/lib/tagger.ts` is a
byte-for-byte port; iterate in the sandbox first, then port and bump
`PROMPT_VERSION`). The text-tagging prompt has no sandbox copy; it lives only
in `lib/tagger.ts`.

Originally this file was the build plan. The feature has shipped; deltas from
the plan are listed at the bottom.

## Where things run

All image processing and LLM calls happen in Convex actions. No browser
preprocessing, no changes to the screenshot worker.

- **`src/convex/taggingActions.ts`** (`"use node"`, 512MB) — every run:
  - `tagImageItem` (visual mode): fetches the original from R2
    (`${R2_PUBLIC_URL}/${imageKey}`), decodes once via `sharp` (`rotate()` for
    EXIF, resize to 1024px max edge, raw RGBA), extracts and writes the
    palette, flattens onto white and encodes JPEG q85, then calls the LLM with
    that JPEG held in memory and writes the result. One action, LLM-bound
    (~13–15s); the Node memory-seconds spent waiting are negligible at this
    scale.
  - `tagTextItem` (text mode): fetches the page and extracts its article text
    (see Triggers), then calls the LLM.
  - `repaletteItem`: palette only, for items that aren't visually tagged.
- **`src/convex/lib/tagger.ts`** — the LLM boundary shared by both modes,
  holding no Convex functions: prompts, model params, the OpenRouter call with
  retries, `parseJsonLenient`, `validateTags`, `normalizeTag`.
- **`src/convex/tagging.ts`** — the database side: the `taggingPool`
  workpool, `setCompleted` / `setFailed` / `setPaletteHex`, and the public
  `retagItem`.

### Statuses and the pool

`taggingStatus` and `screenshotStatus` are each `pending` → `completed` |
`failed`. `pending` is written in the same transaction that enqueues the run
and is cleared only when the run settles, so it is also what stops
`retagItem` / `reimageItem` from starting a second, overlapping run.

Every tagging run is enqueued through `enqueueTagging` onto `taggingPool`
(max 10 in parallel, no pool-level retries). A run records its own outcome
(`setCompleted`, or `setFailed` for anything it throws: missing image or URL,
missing `OPENROUTER_API_KEY`, fetch, LLM). If it dies without doing so (OOM,
timeout, restart), `onTaggingComplete` marks the still-`pending` item
`failed`. Screenshots work the same way through `screenshotPool` and
`onScreenshotComplete`.

## Palette extraction

Color Thief MMCQ (`colorthief/internals`: recursive RGB median-cut with a
two-phase priority queue), 5 colors, sampling every 10th pixel, sorted by
population. Captures distinct color clusters well — small accents survive
Phase 2's count×volume splitting — at the cost of occasional phantom swatches
on images with widely-separated clusters.

`paletteHex` is written by `setPaletteHex` in `tagImageItem` **before** the
LLM call, so swatches land even if tagging fails. The same mutation derives
`paletteNames` — named-color tokens via OKLCh nearest-anchor matching
(`src/convex/lib/colorNames.ts`) — deterministically from the hex values.
(The LLM palette-description string from `design.md` was dropped; color words
come from pixels, not the model.)

`repaletteItem` re-runs palette extraction alone, without re-tagging.

## Items schema (as shipped)

```ts
styles: v.optional(v.array(v.string())),
subject: v.optional(v.string()),
aiTags: v.optional(v.array(v.string())),      // named aiTags to leave room for user tags later
paletteHex: v.optional(v.array(v.string())),  // ["#rrggbb", ...], population-ordered
paletteNames: v.optional(v.array(v.string())),
taggingStatus: v.optional(v.union('pending' | 'completed' | 'failed')),
taggingError: v.optional(v.string()),
taggingModelVersion: v.optional(v.string()),  // `${model}:${PROMPT_VERSION}`, e.g. "openai/gpt-6-luna:v5"
```

`searchText` **does** include tagging output: `buildSearchText()` in
`src/convex/lib/searchText.ts` combines title + description + ogDescription +
url + a text item's content + subject + styles + aiTags + paletteNames + font
names, and is rebuilt (from the item spread with the fields being written) by
every mutation that touches any of those fields (`setCompleted`,
`setPaletteHex`, `screenshots.setCompleted`, item edits).

## OpenRouter call

`tag_qwen.py` is the source of truth for the prompt and params; production
constants live at the top of `src/convex/lib/tagger.ts`.

- Model: `openai/gpt-6-luna` by default (moved from GPT-5.6 Luna on
  2026-10-30; that was adopted 2026-08-28 after the round-2 bake-off in
  `model-comparison-2026-08-round2.md`); `TAGGING_MODEL` env var overrides
  without a code change (useful for A/B trials — `taggingModelVersion` records
  which model tagged each item).
- `PROMPT_VERSION`: `v5` (visual), `text-v3` (text). Bump on any prompt change.
- Temperature 0.3, `max_tokens` 600, `response_format: { type: 'json_object' }`.
- `reasoning: { enabled: false }` — a matrix sweep (4 images × 6 treatments ×
  3 trials) showed reasoning drifts the model away from specific
  named-movement labels and reduces re-tag stability; disabled is also ~5×
  cheaper.
- Headers: `Authorization`, `HTTP-Referer`, `X-Title`. Timeout 60s.
- Image sent as a `data:image/jpeg;base64,...` `image_url` content block
  alongside the text prompt.
- `body.usage` is logged per call — the only per-tag cost signal.

## Validation

Ported from `tag_qwen.py` (`normalizeTag` and `dedupePreserveOrder` are
tested in `src/convex/lib/searchText.spec.ts`):

- `parseJsonLenient` — strip markdown fences, locate the outermost `{...}`,
  `JSON.parse`.
- `validateTags(parsed, maxStyles)` — schema check + normalization. Remaps
  JSON `tags` → `aiTags` at this boundary. `styles`: ≥1 non-empty string,
  normalized + deduped, capped at `maxStyles`. `subject`: non-empty string.
  `aiTags`: ≥3 entries, normalized + deduped, entries already in `styles`
  removed, cap 12. Tested in `src/convex/lib/tagger.spec.ts` with
  `parseJsonLenient`.
- `normalizeTag` — lowercase, collapse whitespace, strip edge punctuation,
  drop trailing generic modifiers (`aesthetic`, `style`, `vibes`, `vibe`) and
  suffix-noise words (`design`, `influenced`, `driven`, `based`, `heavy`)
  when another word remains, strip the same suffix-noise as a hyphenated tail
  (`swiss-influenced` → `swiss`), then singularize (with a `KEEP_PLURAL`
  exception list).

Text tagging validates the same way but caps `styles` (genre labels) at 4.

Validation failure → retried (see below) → action throws → `setFailed`.

## Triggers

| Source                     | When                                      | Enqueues                                                     |
| -------------------------- | ----------------------------------------- | ------------------------------------------------------------ |
| `items.add`                | `type === 'image'` and `imageKey` present | `tagImageItem` if visual tagging is on, else `repaletteItem` |
| `items.add`                | URL item with `taggingMode: 'text'`       | `tagTextItem`                                                |
| `screenshots.setCompleted` | after patching imageKey/dimensions        | `tagImageItem` if visual tagging is on, else `repaletteItem` |
| `tagging.retagItem`        | public mutation, auth-gated               | `tagImageItem` or `tagTextItem` (per requested mode)         |

Tagging runs go through `taggingPool`; `repaletteItem` is a plain scheduled
action (it writes no status, so there is nothing to settle). "Visual tagging
is on" means `taggingMode` is neither `'none'` nor `'text'`; palette
extraction always runs on a new image. `retagItem` also switches the item's
`taggingMode` to the mode it ran; to `'none'` (AI off) it runs nothing and
clears the item's tags and embedding instead.

Text items are never tagged. URL items with `taggingMode: 'text'` skip visual
tagging entirely: `tagTextItem` (no worker/browser involvement) fetches the
page (body read capped at 4M chars), extracts readable text via Defuddle +
linkedom, truncates to 8k chars, and produces genre labels → `styles`,
summary → `subject`, topic tags → `aiTags` (`TEXT_PROMPT_VERSION` stamps
`taggingModelVersion`). The image still gets palette extraction via
`repaletteItem`.

Runs never overlap on one item: `retagItem` refuses while tagging is
`pending` (and, in visual mode, while the screenshot is `pending`, since the
image is about to be replaced); `reimageItem` refuses while either the
screenshot or tagging is `pending`, so a tagging run's results can't land on
an image that replaced the one it read. A finished screenshot enqueues the
visual run itself. User-facing refusals are `ConvexError`s so their message
survives production redaction.

## Retry semantics

Each run retries the LLM call in place (`requestTags` in `lib/tagger.ts`):
up to 3 attempts with 1s / 3s backoff, covering transport, JSON-parse and
schema failures alike. If all attempts fail it sets `taggingStatus:
'failed'` + `taggingError`; there is no pool-level retry, so the user
re-invokes via `retagItem`. Old tag fields are overwritten by the next
successful `setCompleted`.

## Env vars (Convex deployment)

Documented in `reference/ops.md`, set via `npx convex env set`:

- `OPENROUTER_API_KEY` (required)
- `TAGGING_MODEL` (optional, defaults to `DEFAULT_MODEL` in `tagging.ts`)
- `R2_PUBLIC_URL` (used by `tagImageItem` / `repaletteItem` to fetch originals)

## Deltas from the original build plan

- `kind` (artwork/graphic_design/website/photograph enum) was cut — the
  prompt never asks for it and the schema never grew it.
- `taggingRetries` counter was cut; failures just record status + error.
- Palette uses Color Thief MMCQ, not the `quantize` package sketched here.
- `paletteNames` (deterministic color words) were added, replacing the
  planned LLM palette-description string.
- Reasoning ended up fully disabled, not capped at 1500 tokens.
- searchText integration — deferred in the plan — has shipped (see above).
- The regenerate-tags UI button shipped in `ItemEditor.svelte` (via
  `tagging.retagItem`).
- The planned Node → default-runtime hop for the LLM call was built, then
  merged back into one Node action: passing a ~1MB base64 JPEG between
  actions cost more complexity than the memory-seconds it saved.
- Text tagging (`taggingMode: 'text'`) and per-collection ingestion defaults
  were added after the plan.
- The `/atlas` page (color fingerprint + style constellation) is the first
  tag-browsing surface, computed client-side from the loaded items.
- Still unbuilt: `semanticText`/embeddings/vector search, a `/tags` index
  page, tag-quality eval harness beyond the sandbox scripts here.
