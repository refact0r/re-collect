# AI Tagging — Implementation Architecture (as built)

Describes the shipped tagging pipeline. Companion to `design.md` (product
framing) and `tag_qwen.py` (canonical source of the prompt, model params, and
validation logic — production in `src/convex/tagging.ts` is a byte-for-byte
port; iterate in the sandbox first, then port and bump `PROMPT_VERSION`).

Originally this file was the build plan. The feature has shipped; deltas from
the plan are listed at the bottom.

## Where things run

All image processing and LLM calls happen in Convex actions. No browser
preprocessing, no changes to the screenshot worker.

- **Node.js runtime** (`"use node"`, `src/convex/taggingActions.ts`, 512MB):
  fetches the original from R2 (`${R2_PUBLIC_URL}/${imageKey}`), decodes once
  via `sharp` (`rotate()` for EXIF, resize to 1024px max edge, raw RGBA),
  re-encodes to JPEG q85 for the LLM, and extracts a 5-color hex palette.
  Hands off to the default runtime for the long-running LLM call so we don't
  burn 512MB-seconds waiting on OpenRouter.
- **Default runtime** (`src/convex/tagging.ts`, 64MB): receives preprocessed
  base64 + mime, calls OpenRouter, validates, writes results. LLM-bound,
  ~13–15s.

## Palette extraction

Color Thief MMCQ (`colorthief/internals`: recursive RGB median-cut with a
two-phase priority queue), 5 colors, sampling every 10th pixel, sorted by
population. Captures distinct color clusters well — small accents survive
Phase 2's count×volume splitting — at the cost of occasional phantom swatches
on images with widely-separated clusters.

`paletteHex` is written by `setPaletteHex` during preprocessing, **before**
the LLM call, so swatches land even if tagging fails. The same mutation
derives `paletteNames` — named-color tokens via Lab nearest-neighbor lookup
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
taggingStatus: v.optional(v.union('pending' | 'processing' | 'completed' | 'failed')),
taggingError: v.optional(v.string()),
taggingModelVersion: v.optional(v.string()),  // `${model}:${PROMPT_VERSION}`, e.g. "qwen/qwen3.7-flash:v4"
```

`searchText` **does** include tagging output: `buildSearchText()` in
`src/convex/lib/searchText.ts` combines title + description + url + subject +
styles + aiTags + paletteNames, and is rebuilt by every mutation that touches
any of those fields (`setCompleted`, `setPaletteHex`, item edits).

## OpenRouter call

`tag_qwen.py` is the source of truth for the prompt and params; production
constants live at the top of `src/convex/tagging.ts`.

- Model: `qwen/qwen3.7-flash` by default (adopted Aug 2026 after the
  bake-off in `model-comparison-2026-08.md`); `TAGGING_MODEL` env var overrides
  without a code change (useful for A/B trials — `taggingModelVersion`
  records which model tagged each item).
- `PROMPT_VERSION`: `v4`. Bump on any prompt change.
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

Ported from `tag_qwen.py` (tested in `src/convex/lib/searchText.spec.ts`):

- `parseJsonLenient` — strip markdown fences, locate the outermost `{...}`,
  `JSON.parse`.
- `validateTags` — schema check + normalization. Remaps JSON `tags` →
  `aiTags` at this boundary. `styles`: ≥1 non-empty string, normalized +
  deduped, cap 8. `subject`: non-empty string. `aiTags`: ≥3 entries,
  normalized + deduped, entries already in `styles` removed, cap 12.
- `normalizeTag` — lowercase, collapse whitespace, strip edge punctuation,
  drop trailing generic modifiers (`aesthetic`, `style`, `vibes`, `vibe`) and
  suffix-noise words (`design`, `influenced`, `driven`, `based`, `heavy`)
  when another word remains, strip the same suffix-noise as a hyphenated tail
  (`swiss-influenced` → `swiss`), then singularize (with a `KEEP_PLURAL`
  exception list).

Validation failure → action throws → `setFailed`.

## Triggers

| Source                     | When                                      | Schedules                                |
| -------------------------- | ----------------------------------------- | ---------------------------------------- |
| `items.add`                | `type === 'image'` and `imageKey` present | `internal.taggingActions.preprocessItem` |
| `screenshots.setCompleted` | after patching imageKey/dimensions        | `internal.taggingActions.preprocessItem` |
| `tagging.retagItem`        | public mutation, auth-gated               | `internal.taggingActions.preprocessItem` |

Text items are never tagged. A screenshot retry produces a new `imageKey` and
unconditionally schedules another tagging run; for a single-user app the
blast radius of a concurrent duplicate is a wasted OpenRouter call — don't
fan this trigger out further without an idempotency guard.

## Retry semantics

No automatic retries. A failed action sets `taggingStatus: 'failed'` +
`taggingError`; the user re-invokes via `retagItem` (which rejects if a run
is already `pending`/`processing`). Old tag fields are overwritten by the
next successful `setCompleted`.

## Env vars (Convex deployment)

Documented in `reference/ops.md`, set via `npx convex env set`:

- `OPENROUTER_API_KEY` (required)
- `TAGGING_MODEL` (optional, defaults to `DEFAULT_MODEL` in `tagging.ts`)
- `R2_PUBLIC_URL` (used by preprocessing to fetch originals)

## Deltas from the original build plan

- `kind` (artwork/graphic_design/website/photograph enum) was cut — the
  prompt never asks for it and the schema never grew it.
- `taggingRetries` counter was cut; failures just record status + error.
- Palette uses Color Thief MMCQ, not the `quantize` package sketched here.
- `paletteNames` (deterministic color words) were added, replacing the
  planned LLM palette-description string.
- Reasoning ended up fully disabled, not capped at 1500 tokens.
- searchText integration — deferred in the plan — has shipped (see above).
- Still unbuilt: `semanticText`/embeddings/vector search, `/tags` index
  page, regenerate-tags UI button, bulk re-tag migration, tag-quality eval
  harness beyond the sandbox scripts here.
