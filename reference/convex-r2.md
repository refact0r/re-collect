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
   the one place presigning IS used) and records the key in `uploads` against
   the caller.
2. Client `fetch(url, { method: 'PUT', body: file })`.
3. `api.r2.syncMetadata` → schedules the component's metadata sync for the key
   (caller's own uploads only).
4. The item is created with `imageKey` set to the returned key. `items.add`
   only accepts a key from the caller's own `uploads` row and deletes that row,
   so each object belongs to exactly one item (deleting the item deletes the
   object, which must never reach another user's image).

Remote images from the browser extension skip the presigned PUT:
`api.imageImport.addFromUrl` (a Node action) fetches the image server-side,
stores it with `r2.store()` (UUID key, metadata synced) and creates the item.
`api.imageImport.addPageWithImage` does the same for the extension's own
screenshots (sent as a `data:` URL), attaching them to a URL item.

The screenshot worker (`workers/screenshot`) writes to the same bucket
directly via its R2 binding (keys under `screenshots/` and `og/`), bypassing
the component.

## Serving (no presigning)

Images are served from a public custom domain on the bucket. URLs are stable:
`${R2_PUBLIC_URL}/${imageKey}` — built in `getImageUrl()` in
`src/convex/items.ts` and in `taggingActions.ts` for fetching originals.
Don't switch this to `r2.getUrl()`/presigned GETs: stable URLs are cacheable
and the bucket is intentionally public-read.
