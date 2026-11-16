# Image variants

Every item image gets smaller WebP copies, so a small display (atlas cards,
pattern thumbnails, collection mosaics, grid columns) never downloads or
decodes the original. Built 2026-11-16 as a prototype; the open decisions are
at the end.

## Why

Originals are whatever came in: worker screenshots (1440×900 WebP, ~90 KB),
extension captures at 2x (2880 wide), og:images, and uploads of up to 30 MB
(the largest is 5865×3907). The atlas draws ~100-400 of them at 32-320px and
patterns at ~4rem, so the browser fetched and decoded full-size images to show
them tiny. That was behind the atlas repaint stalls (`f2144f6`).

Measured on the dev library (95 images, 2026-11-16):

| what the page loads            | total        |
| ------------------------------ | ------------ |
| every original                 | 125.6 MB     |
| every 256px copy               | 0.6 MB       |
| every 768px copy (or original) | 4.1 MB       |
| storage the copies add         | 7.4 MB (~6%) |

Median sizes: original 106 KB, 256px copy 4.8 KB, 768px copy 26.6 KB.

## Options considered

- **Cloudflare Image Transformations** (`/cdn-cgi/image/…` on the image
  domain): no code, but billed per unique transformation (source × params) per
  calendar month: 5,000 free, then $0.50 per 1,000
  ([pricing](https://developers.cloudflare.com/images/pricing/)). At today's
  ~100 items × 3 widths it would sit inside the free 5,000; it becomes a
  standing cost as the library (and other users' libraries) grows, and every
  image is re-counted each month it's viewed. Ruled out for being a continuous
  cost.
- **Resize in the screenshot worker**: Workers can't run sharp/libvips, a WASM
  encoder blows the free plan's CPU limit, and it only sees screenshots and
  og:images, not uploads or extension saves.
- **Resize in the browser before upload**: covers only the app's own upload
  path, and the canvas re-encode would be the only copy.
- **A Convex Node action with sharp** (chosen): sharp is already a dependency
  (`imageImport`, `taggingActions`), every way in ends in an item with an
  `imageKey`, so one hook covers them all. Costs: Node action compute is 20
  GB-hours/month free on Starter, 250 on Pro, then ~$0.30/GB-hour
  ([pricing](https://www.convex.dev/pricing)). A run is ~0.2-0.7s of sharp per
  image at the 512 MB Node action size, so ~0.0001 GB-hours: the free tier
  covers tens of thousands of images a month. R2 adds ~3 PUTs per image and
  ~6% storage, both negligible; reading the original from the bucket is free
  egress.

## How it works

- `items.imageVariants`: `{ key, width }[]`, narrowest first. Unset = not made
  yet for the current image; `[]` = nothing to make (already small) or the
  image couldn't be read.
- Widths `256 / 768 / 1536` (`VARIANT_WIDTHS` in `lib/imageVariants.ts`), each
  made only when at least 25% narrower than the original. Picked from what the
  surfaces show at 1x and 2x: thumbnails and atlas cards at their usual sizes
  (32-104px), grid columns and larger atlas cards, the modal and wide columns.
  A 1440 screenshot gets 256 and 768; a 2880 capture or a big upload all three.
- **Making them**: `scheduleImageVariants(ctx, itemId)` queues
  `imageVariantActions.makeVariants` on `variantPool` (3 at a time, retried).
  Called by `items.add` when the item arrives with an image (uploads, extension
  saves and screenshots, discovery keeps) and by `screenshots.setCompleted`
  (worker captures, re-captures). The run reads the original from the bucket,
  decodes it once at the widest copy's size (stills; an animation is re-read
  per copy so it stays animated), writes WebP q80 copies to
  `variants/{itemId}-{ts}-{width}w.webp` with `signUpload`, and records them
  with `saveVariants`, which drops them if the image changed meanwhile. EXIF
  orientation is applied (WebP output carries none). Very tall images are held
  to WebP's 16383px limit.
- **Deleting them**: `deleteImageObjects` deletes the original and its copies;
  `items.remove` and `setCompleted` (on a new image) go through it.
- **Serving them**: `imageFields(item)` in `items.ts` returns `imageUrl` (the
  original, unchanged) and `imageSrcset` (copies plus the original at its own
  width, null until there are copies). Each `<img>` sets `srcset` and a
  `sizes` for how wide it shows, and the browser picks the smallest copy that
  covers it at the screen's density: grid `columnWidth`, atlas card width,
  patterns `6rem`, mosaics `8rem`, the atlas panel `5rem` / `19rem`, list `2rem`.
  The item modal keeps the original. Verified in the browser at DPR 2: atlas
  and patterns load only 256s, the grid (363px columns) 768s.
- **Backfill**: `npx convex run imageVariants:backfill` (`--prod` for
  production) queues every image without `imageVariants`.

Memory: decoding once matters. Peak RSS on the largest real images was
130-165 MB; a synthetic 8000×8000 PNG peaked at ~350 MB (it was ~920 MB when
each width re-decoded the original). Node actions get 512 MB. A run that runs out of
memory is retried, then the image is left without copies and shown as the
original.

## Gotchas found

- `signUpload` used to percent-encode a key's `/`, which R2 rejects (403) for
  any key with a prefix. It now encodes per segment. Uploads were unaffected
  (their keys are bare UUIDs).
- Local deployments: `new R2(components.r2)` reads its config when the module
  loads, and the local Node executor keeps modules loaded across `env set`
  ([convex-backend#639](https://github.com/convex/convex-backend/issues/639)).
  Set the R2 env vars before the first push, or restart `convex dev` after
  setting them, or Node actions see an empty R2 config.

## Open decisions

- **Capping originals**: not done. Originals stay as uploaded (fidelity for
  zooming in), and only the modal still loads them. The modal could use the
  srcset too (with 1536 it would cut big uploads to a few hundred KB on 1x
  screens, but look soft on 2x at full modal size), or a capped "display"
  original could replace very large uploads.
- **Width steps**: 256/768/1536 fit today's surfaces. A 2x screen with wide
  grid columns (fewer columns, ~500px+) skips to the original for 1440
  screenshots; a 1024 step would cover that.
- **Tagging, palette and embedding** still download the original and shrink it
  to 1024px themselves (`taggingActions.fetchAndDecode`). They could read the
  768 or 1536 copy instead, but they run in parallel with the copies being
  made, so they'd need to wait or fall back.
- **AVIF** would be ~20-30% smaller than WebP but encodes several times slower;
  WebP is the safe default.
- The worker's own screenshots could be captured smaller (or as JPEG/AVIF)
  instead; the copies make this unnecessary for display.
