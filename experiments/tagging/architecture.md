# AI Tagging — Implementation Architecture

Build plan for the AI image tagging feature. Companion to `design.md` (product
framing) and `tag_qwen.py` (source of truth for prompt, model params, and
validation logic).

**Scope of this build.** Store tagging output on `items`. Do not surface it
yet — no `/tags` page, no chip filters, no "more like this", no regenerate
button UI, no search integration. Subsequent features will read these fields.

## Where things run

All image processing and LLM calls happen in Convex actions. No browser
preprocessing, no changes to the screenshot worker.

- **Node.js runtime** (`"use node"`, 512MB): fetches the original from R2 and
  runs `sharp` for downscale + hex palette extraction. Hands off to the
  default runtime for the long-running LLM call so we don't burn 512MB-seconds
  while waiting on OpenRouter. Expected duration ~2–4s.
- **Default runtime** (64MB): receives preprocessed bytes + hex palette, calls
  OpenRouter, validates, writes results. Expected duration ~13–15s
  (LLM-bound).

This split keeps Convex action compute down — see the compute discussion in
the chat log if context is needed, but the short version: a ~15s LLM wait at
64MB costs 8× less than at 512MB, and the only thing that genuinely needs
Node.js is `sharp`.

## Schema additions

Add to the `items` table in `src/convex/schema.ts`. All optional — no
backfill needed to land the schema.

```ts
// LLM tagger output (per design.md §"LLM tagger output")
kind: v.optional(v.union(
  v.literal('artwork'),
  v.literal('graphic_design'),
  v.literal('website'),
  v.literal('photograph'),
  v.literal('other'),
)),
styles: v.optional(v.array(v.string())),
subject: v.optional(v.string()),
aiTags: v.optional(v.array(v.string())),       // named aiTags to leave room for user tags later

// Deterministic palette (extracted from pixels, not LLM)
paletteHex: v.optional(v.array(v.string())),   // ["#rrggbb", ...]

// Status tracking — mirrors the screenshot status pattern
taggingStatus: v.optional(v.union(
  v.literal('pending'),
  v.literal('processing'),
  v.literal('completed'),
  v.literal('failed'),
)),
taggingError: v.optional(v.string()),
taggingRetries: v.optional(v.number()),
taggingModelVersion: v.optional(v.string()),   // e.g. "qwen/qwen3.6-flash:v1" — lets future migrations target stale tags
```

Do **not** fold these fields into `searchText` yet. Do **not** add a
`semanticText` column or vector index yet. Those land with the search /
discovery surfaces, not now.

## Files to create

### `src/convex/tagging.ts` (default runtime)

- `internalMutation setProcessing({ itemId })` — patches `taggingStatus: 'processing'`.
- `internalMutation setCompleted({ itemId, kind, styles, paletteHex, subject, aiTags, modelVersion })` — patches all fields, sets status to `'completed'`, clears `taggingError`. Does **not** reset `taggingRetries` — matches `screenshots.setCompleted` which leaves `screenshotRetries` in place as a lifetime counter.
- `internalMutation setFailed({ itemId, error, retries })` — patches status + error + retries.
- `internalMutation setPaletteHex({ itemId, paletteHex })` — patches just the hex palette. Called by the preprocessing action so swatches land even if the LLM call later fails.
- `internalAction callOpenRouter({ itemId, downscaledBase64, mime, retryCount })`:
  1. POST to OpenRouter using the prompt, model, and params from `tag_qwen.py` (see "OpenRouter call" below).
  2. Parse + validate via ported helpers (see "Validation" below).
  3. On success: `runMutation setCompleted` with all fields. Log `body.usage` for cost telemetry — this is the only per-tag cost signal you'll have, cheap to capture now, expensive to backfill.
  4. On failure: `runMutation setFailed`. No auto-retry (matches the screenshot pattern).
- `mutation retagItem({ itemId, token })` — public, auth-gated via `requireAuth`. Mirrors `retryScreenshot` in `src/convex/screenshots.ts`:
  1. Validate item exists, has `imageKey`, and `type !== 'text'`.
  2. Reject if `taggingStatus` is `'processing'` or `'pending'` (avoid concurrent OpenRouter calls).
  3. Synchronously patch `taggingStatus: 'pending'`, clear `taggingError`, bump `taggingRetries`.
  4. Schedule `internal.taggingActions.preprocessItem` with `retryCount = (existing taggingRetries ?? 0) + 1`.

  Mutation (not action) so the status flip is immediate for the future UI. Backs a future "regenerate tags" UI; for now also useful for ad-hoc testing.

### `src/convex/taggingActions.ts` (`"use node"`)

- `internalAction preprocessItem({ itemId, retryCount })`:
  1. Read item via `ctx.runQuery`. Bail if no `imageKey` or `type === 'text'`.
  2. `setProcessing`.
  3. Fetch original bytes from `${R2_PUBLIC_URL}/${imageKey}`.
  4. With `sharp(buf).rotate()` (auto-orient via EXIF):
     - Downscale → JPEG quality 85, max edge 768px (matches `MAX_EDGE_PX` in `tag_qwen.py`). `resize({ width: 768, height: 768, fit: 'inside', withoutEnlargement: true })`.
     - Separately extract raw pixels for palette extraction:
       ```ts
       const { data } = await sharp(buf).rotate().resize({ width: 200 }).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
       const pixels: [number, number, number][] = [];
       for (let i = 0; i < data.length; i += 4) pixels.push([data[i], data[i+1], data[i+2]]);
       const cmap = quantize(pixels, 5);
       const paletteHex = cmap ? cmap.palette().map(([r,g,b]) => '#' + [r,g,b].map(x => x.toString(16).padStart(2,'0')).join('')) : [];
       ```
       `quantize` returns `null` for flat-color images; fall back to an empty array (or a single dominant color if you want to be fancy).
  5. `setPaletteHex` with the hex palette — persists immediately, independent of LLM success.
  6. `ctx.scheduler.runAfter(0, internal.tagging.callOpenRouter, { itemId, downscaledBase64, mime: 'image/jpeg', retryCount })`. Return.
  7. If anything in this action throws: `setFailed`.

Keep this file mutation-free; `"use node"` files cannot register queries or
mutations.

## Files to edit

### `src/convex/schema.ts`
Add the fields listed above to the `items` table.

### `src/convex/items.ts`
In the `add` mutation, after the existing screenshot scheduling, schedule
tagging for image items:

```ts
if (args.type === 'image' && args.imageKey) {
  await ctx.scheduler.runAfter(0, internal.taggingActions.preprocessItem, {
    itemId, retryCount: 0,
  });
}
```

Do **not** trigger here for URL items — wait for the screenshot to complete.

### `src/convex/screenshots.ts`
In `setCompleted`, after the existing `ctx.db.patch`, schedule tagging:

```ts
await ctx.scheduler.runAfter(0, internal.taggingActions.preprocessItem, {
  itemId: args.itemId, retryCount: 0,
});
```

This is the natural fan-out for URL items: every fresh screenshot triggers a
fresh tagging pass.

Note: a screenshot retry produces a new `imageKey` and unconditionally schedules
another tagging run, even if a prior run for the old key is still in flight.
For a single-user app the blast radius is negligible (at worst a wasted
OpenRouter call), but don't fan this trigger out further without adding an
idempotency guard.

## OpenRouter call

Port verbatim from `tag_qwen.py`. The prompt and params are the source of truth.

- Model: `qwen/qwen3.6-flash` (configurable via `TAGGING_MODEL` env var; default to this).
- Temperature: 0.3
- `max_tokens`: 600
- `response_format`: `{ type: 'json_object' }`
- `reasoning`: `{ max_tokens: 1500 }` (Qwen 3.6 Flash is a thinking model; this cap matters)
- Headers: `Authorization: Bearer ${OPENROUTER_API_KEY}`, `HTTP-Referer`, `X-Title`
- Timeout: 60s
- Prompt: copy the `PROMPT` string from `tag_qwen.py` byte-for-byte. Do not paraphrase or "improve" it; it has been iterated on.

Send the downscaled image as a `data:image/jpeg;base64,...` URL in an
`image_url` content block, alongside the text prompt — same shape as in
`tag_qwen.py`.

Persist `taggingModelVersion` as `` `${MODEL}:${PROMPT_VERSION}` ``. Define
both as top-of-file constants in `tagging.ts` (e.g. `const PROMPT_VERSION = 'v1'`)
so bumping on prompt change is a one-line edit and grep-friendly.

## Validation

Port to TypeScript from `tag_qwen.py`:

- `parse_json_lenient` — strip markdown fences, locate the outermost `{...}`, `JSON.parse`.
- `validate_tags` — schema check + normalization. **Remap JSON keys at this boundary:** the prompt returns `tags`; persist as `aiTags`. Enforce:
  - `kind` ∈ the five literals.
  - `styles`: non-empty array of non-empty strings; after `normalize_tag` + dedupe, cap at 5.
  - `subject`: non-empty string.
  - `aiTags` (from JSON `tags`): at least 3 entries; after normalize + dedupe, *remove any that already appear in `styles`*, cap at 12.
- `normalize_tag` — lowercase, collapse whitespace, strip leading/trailing punctuation, drop trailing generic modifiers (`aesthetic`, `style`, `vibes`, `vibe`) when there's another word, then `singularize_word`.
- `singularize_word` — see `tag_qwen.py` for the rules and the `KEEP_PLURAL` list. Don't reinvent; port them.

On validation failure: treat as a retryable error (action throws → `setFailed`).

## Triggers summary

| Source              | When                                       | Action scheduled                              |
| ------------------- | ------------------------------------------ | --------------------------------------------- |
| `items.add`         | `type === 'image'` and `imageKey` present  | `internal.taggingActions.preprocessItem`      |
| `screenshots.setCompleted` | after patching imageKey/dimensions   | `internal.taggingActions.preprocessItem`      |
| `tagging.retagItem` | public, auth-gated                         | `internal.taggingActions.preprocessItem`      |

Text items: never tagged.

## Retry semantics

- No automatic retries. A failed action sets `taggingStatus: 'failed'` and increments `taggingRetries`. The user (or a future button) re-invokes via `retagItem`.
- A screenshot retry produces a new `imageKey`, which re-triggers tagging via `setCompleted`. Old tag fields are simply overwritten by the next `setCompleted` mutation.
- `paletteHex` lands during preprocessing, before the LLM call. If the LLM call fails, swatches are still available.

## Env vars

Add to `reference/ops.md` and set via `npx convex env set`:

- `OPENROUTER_API_KEY` (required)
- `TAGGING_MODEL` (optional, defaults to `qwen/qwen3.6-flash`)

## Dependencies to add

- `sharp` (Node.js runtime, native — Convex's Node.js runtime supports it via prebuilt binaries). **De-risk first:** before writing the rest of `preprocessItem`, deploy a stub that does nothing but `sharp(buf).metadata()` against an R2 image and confirm it runs in the deployed Node action. Native deps on Convex have historically tripped on linux-musl/glibc bundling; if this fails the whole plan changes (palette extraction in the Cloudflare worker, or pure-JS resize).
- `quantize` (small, pure-JS median-cut for hex palette)

## Out of scope (do not build)

These are deliberately deferred to keep this change focused:

- `searchText` updates to include tags/styles
- `semanticText` column, embeddings, vector index, "more like this"
- `/tags` index page
- Regenerate-tags button in the item modal UI (the `retagItem` action exists; the UI does not)
- Palette swatch display on the item modal
- Bulk re-tag migration
- Tag-quality eval harness

The completion criterion for this build is: image items and URL items
automatically gain LLM tags + a hex palette shortly after creation /
screenshot, with status visible on the item row in the Convex dashboard.
Nothing in the user-facing UI changes.
