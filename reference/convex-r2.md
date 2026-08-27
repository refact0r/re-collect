# R2 Integration

How this app uses Cloudflare R2, via the `@convex-dev/r2` Convex component.
Upstream docs: https://www.convex.dev/components/cloudflare-r2 — note that the
upstream examples lean on presigned GET URLs, which this app deliberately does
**not** use for serving.

## Setup

- Component registered in `src/convex/convex.config.ts` (`app.use(r2)`).
- Convex env vars (see `reference/ops.md`): `R2_TOKEN`, `R2_ACCESS_KEY_ID`,
  `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`, `R2_BUCKET`.

## Uploads (image items)

Client-side flow in `ItemInput.svelte`, backed by two auth-gated mutations in
`src/convex/r2.ts`:

1. `api.r2.generateUploadUrl` → returns `{ key, url }` (a presigned PUT URL —
   the one place presigning IS used).
2. Client `fetch(url, { method: 'PUT', body: file })`.
3. `api.r2.syncMetadata` → schedules the component's metadata sync for the key.
4. The item is created with `imageKey` set to the returned key.

The screenshot worker (`workers/screenshot`) writes to the same bucket
directly via its R2 binding (keys under `screenshots/` and `og/`), bypassing
the component.

## Serving (no presigning)

Images are served from a public custom domain on the bucket. URLs are stable:
`${R2_PUBLIC_URL}/${imageKey}` — built in `getImageUrl()` in
`src/convex/items.ts` and in `taggingActions.ts` for fetching originals.
Don't switch this to `r2.getUrl()`/presigned GETs: stable URLs are cacheable
and the bucket is intentionally public-read.
