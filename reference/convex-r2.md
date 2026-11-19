# R2 Integration

How this app uses Cloudflare R2, via the `@convex-dev/r2` Convex component.
Upstream docs: https://www.convex.dev/components/cloudflare-r2 — note that the
upstream examples lean on presigned GET URLs, which this app deliberately does
**not** use for serving.

## Setup

- Component registered in `src/convex/convex.config.ts` (`app.use(r2)`).
- Convex env vars (see `reference/ops.md`): `R2_TOKEN`, `R2_ACCESS_KEY_ID`,
  `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`, `R2_BUCKET`.

## Uploads

Only raster images (JPEG, PNG, WebP, GIF, AVIF: `RASTER_IMAGE_TYPES` in
`lib/images.ts`) ever become an item's image: everything in the bucket is served
from the public image domain, same site as the app, where an SVG or HTML file
would run its scripts. Client-side flow in `ItemInput.svelte`:

1. `api.r2.generateUploadUrl({ contentType })` (`src/convex/r2.ts`) refuses
   anything but a raster type, records the key in `uploads` against the caller
   (unverified) and returns `{ key, url }`: a presigned PUT (the one place
   presigning IS used) that `signUpload` signs with `content-type` among its
   signed headers, so R2 rejects a PUT with any other Content-Type and the
   object is served with the one the server allowed. The component's own
   `generateUploadUrl` can't pin a type, hence the hand-rolled SigV4 (checked
   against the AWS SDK's signer in `uploads.test.ts`).
2. Client `fetch(url, { method: 'PUT', headers: { 'Content-Type': … }, body })`.
3. `api.imageImport.verifyUpload({ key })` (a Node action) reads the object
   back from the bucket (presigned GET, not the cached public domain) and
   checks it is served as a raster type, at most 30 MB, and that its bytes
   decode as a raster image (sharp). It then sets the row's `verifiedType`; on
   any failure it deletes the object and the row at once.
4. The item is created with `imageKey` set to the key. `items.add` only
   accepts a key from the caller's own, verified `uploads` row and deletes that
   row, so each object belongs to exactly one item (deleting the item deletes
   the object, which must never reach another user's image).

Unverified rows (abandoned, failed PUT, never checked) are swept with their
objects after a day (`r2.sweepUploads`, daily cron).

Images from the browser extension take the same path, server-side:
`api.imageImport.addFromUrl` (a Node action) fetches a remote image and
`api.imageImport.addPageWithImage` decodes the extension's own screenshot
(only a base64 `data:image/…` URL; it never fetches anything). Each then runs
steps 1–2 from the action via `upload()` and, having checked the bytes itself,
marks the row verified directly (`internal.r2.markVerified`), then creates the
item, an image item or a URL item with that screenshot in place of the
worker's. `fetchImage` (also used by the discovery feed's keep) fetches only
public http(s) addresses (`isPublicWebUrl`: no localhost or private/link-local
IP literals), re-checks each of at most 3 redirects, and stores only raster
types of up to 30 MB, by what the bytes are.

What this leaves open:

- A presigned PUT URL stays valid for 15 minutes, so its holder can PUT again
  after verification and replace the bytes, but only under the same raster
  Content-Type, which browsers never run as a page or script. A PUT's size
  isn't signed either: an oversized upload fails verification and is deleted.
- Optional defence in depth, dashboard configuration (`reference/ops.md`): a
  Transform Rule on the image domain adding `Content-Security-Policy: sandbox;
default-src 'none'` and `X-Content-Type-Options: nosniff`.

The component's `metadata` table isn't used (nothing syncs or reads it);
`r2.deleteObject` deletes the object either way.

The screenshot worker (`workers/screenshot`) writes to the deployment's bucket
(prod's worker to `re-collect`, the dev worker to `re-collect-dev`) directly
via its R2 binding (keys under `screenshots/` and `og/`), bypassing
the component.

## Serving (no presigning)

Images are served from a public custom domain on the bucket. URLs are stable:
`${R2_PUBLIC_URL}/${imageKey}` — built in `imageFields()` in
`src/convex/items.ts` and in `taggingActions.ts` for fetching originals.
`imageFields()` also builds the `srcset` over the image's smaller WebP copies
(`reference/image-variants.md`), which `imageVariantActions` writes under
`variants/` with `signUpload` (a key's slashes are signed as path separators).
Don't switch this to `r2.getUrl()`/presigned GETs: stable URLs are cacheable
and the bucket is intentionally public-read.
