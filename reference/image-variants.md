# Image variants

Every item image gets smaller WebP copies in two tiers, so a small display
never downloads or decodes the full image; an oversized original is replaced,
and an image over the pixel limit is refused at upload.
Built 2026-11-16; the open decisions are at the end.

## Why

Originals are whatever came in: worker screenshots (1440×900 WebP, ~90 KB),
extension captures at 2x (2880 wide), og:images, and uploads of up to 30 MB
(the largest is 5865×3907, and 16 PNG uploads alone are 49 MB). The atlas draws
~100-400 of them at 32-320px and patterns at ~4rem, so the browser fetched and
decoded full-size images to show them tiny. That was behind the atlas repaint
stalls (`f2144f6`).

Measured on the dev library (95 images, 2026-11-16) with AVIF copies; the WebP
q90 copies are about twice their bytes (Quality, below):

| what the page loads                                  | total    |
| ---------------------------------------------------- | -------- |
| every original                                       | 124.6 MB |
| small tier (512, or the original)                    | 1.5 MB   |
| grid tier (2048 or full-width copy, or the original) | 15.5 MB  |
| storage the copies add                               | 7.0 MB   |

The grid figure is mostly the 63 worker screenshots, which the grid shows as
their untouched originals.

## Options considered

- **Cloudflare Image Transformations** (`/cdn-cgi/image/…` on the image
  domain): no code, but billed per unique transformation (source × params) per
  calendar month: 5,000 free, then $0.50 per 1,000
  ([pricing](https://developers.cloudflare.com/images/pricing/)). At today's
  ~100 items × 2 tiers it would sit inside the free 5,000; it becomes a
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
  ([pricing](https://www.convex.dev/pricing)). A run takes a median of ~1.8 s
  per image at the 512 MB Node action size (Memory, below), so ~0.00025
  GB-hours: the free tier covers tens of thousands of images a month. R2 adds
  1-3 PUTs per image and ~10% storage, both negligible; reading the original
  from the bucket is free egress.

## How it works

- **Tiers** (`lib/imageVariants.ts`): `512` for thumbnails, collection mosaics
  and atlas cards (mostly 32-160px, so 2-3x headroom at 2x), `2048` for grid
  columns (~320-540px). A tier is made only when the original is at least 25%
  wider, so most 1440 screenshots get just the 512 copy and the grid shows the
  original. A **heavy** original (over 0.5 bytes per pixel: PNG
  photos and exports, maximum-quality JPEGs; screenshots are ~0.07) narrower
  than 2560 also gets a grid copy at its own width (at most 2048), so the grid
  gets the same pixels as a WebP instead of a multi-megabyte PNG.
- **Upload limit**: an image over `MAX_IMAGE_PIXELS` (32 MP, one frame; AVIF
  `MAX_AVIF_PIXELS`, 8 MP) is refused
  where its bytes are checked (`describeImage` in `imageImport.ts`: app
  uploads, extension saves, discovery keeps), on top of the 30 MB file limit.
  It's the size every step below is budgeted for (Memory, below). Images that
  arrive another way (the worker's og:images) and are over it get no copies.
- **Replaced originals**: a still original wider than `3840` or over 10 MB
  (`MAX_ORIGINAL_WIDTH`, `MAX_ORIGINAL_BYTES`) is replaced by a WebP quality 90
  at most 3840 wide (and 10 MP), upright, keeping its color profile and
  dropping the rest of its metadata (EXIF, GPS). It's stored at
  `originals/{itemId}-{ts}.webp` and becomes the item's `imageKey` (and size);
  the replaced object is deleted an hour later, since tagging, palette and
  embedding runs queued with the item may still be reading it, and the item is
  re-embedded. Animations are left as they came.
- **`items.imageVariants`**: `{ key, width }[]`, narrowest first. Unset = not
  made yet for the current image; `[]` = nothing to make, or the image couldn't
  be read.
- **Making them**: `scheduleImageVariants(ctx, itemId)` queues
  `imageVariantActions.makeVariants` on `variantPool` (three at a time, retried).
  Called by `items.add` when the item arrives with an image (uploads, extension
  saves and screenshots, discovery keeps) and by `screenshots.setCompleted`
  (worker captures, re-captures). The run reads the original from the bucket,
  replaces it if needed, makes the copies from the (replaced) image with
  `signUpload` to `variants/{itemId}-{ts}-{width}w.webp`, and records them with
  `saveVariants`, which drops everything if the image changed meanwhile.
  Copies are WebP quality 90 with smart (sharp YUV) subsampling, upright, keep
  the original's color profile, and skip shrink-on-load (moiré); see Quality
  below. Every encode is held to 10 MP (a very tall image's copy comes out
  narrower) and WebP's 16383px sides; animations stay animated.
- **Deleting them**: `deleteImageObjects` deletes the original and its copies;
  `items.remove` and `setCompleted` (on a new image) go through it.
- **Serving them**: `imageFields(item)` in `items.ts` returns `imageUrl` (the
  original) and `imageSrcset` (the copies, plus the original if it's wider than
  the widest copy). Each copy is offered at 90% of its real width (a 512 copy
  as `460w`), so the browser only picks one it will shrink by at least a tenth
  (Quality, below). Each `<img>` sets `srcset` and a `sizes` for how wide it
  shows, and the browser picks the smallest candidate that covers it at the
  screen's density: grid `columnWidth`, atlas card width, patterns `6rem`,
  mosaics `8rem`, the atlas panel `5rem` / `19rem`, list `2rem`. The item modal
  shows the original. On a 2x screen the grid needs ~730px, so it gets the 2048
  copy or the original; on a 1x screen a column up to 460px gets the 512 copy.
- **Backfill**: `npx convex run imageVariants:backfill` queues every image
  without copies; `'{"remake": true}'` deletes every image's copies and makes
  them again (after changing the tiers or the encoding). Run it on prod only:
  on dev or a local copy of prod's data, capping would delete originals prod
  still points at (`reference/ops.md`, the shared bucket).

Memory: Node actions get 512 MB, and a run must never need more for any image
allowed in. Measured on the dev deployment (2026-11-16) with worst-case
uploads, one at a time (local measurements on a Mac overstate it, since macOS
keeps freed memory):

- With a 16 MP encode budget, JPEG, WebP, PNG and GIF passed at 16-40 MP, but
  tall images (1440 wide, 16-40 MP) sometimes ran out of memory on the first
  attempt and only passed on the pool's retry; the full-width WebP encode was
  the costly step. Hence `MAX_ENCODE_PIXELS` = 10 MP (a 3840×2560 replacement
  still fits) and a 32 MP upload limit, for margin.
- AVIF input decodes whole, at several times the memory: it failed every
  attempt at 25 MP and up and was flaky at 12-20 MP, so AVIF uploads are
  limited to 8 MP (`MAX_AVIF_PIXELS`).
- The palette run (`taggingActions.repaletteItem`, not retried) also ran big
  AVIFs and a 40 MP GIF out of memory, so it runs sharp the same way.

sharp runs with its cache off and one libvips thread (both modules). Concurrent
Node actions don't share memory: probed on dev (2026-11-16), four actions
started at once each ran in their own instance and together held 1.2 GB
without failing, so the pool runs three images at a time. Instances are reused
one call after another, though, so a run can inherit a warm instance's
leftovers. A second round at these limits (32 MP JPEG, WebP, PNG, GIF, animated
GIF and tall captures; 8 MP AVIF) made every image's copies, but one first
attempt of eleven ran out and passed on the retry; the prod remake of 96 images
(about 5 minutes one at a time, a median of 1.8 s each, mostly fixed overhead
rather than sharp) had one too. So the guarantee is: alone, any image allowed
in fits with room to spare, and the pool's three attempts cover a warm
instance's leftovers. A run that fails all three leaves the image without copies,
shown as the original. The palette run isn't retried (it isn't on a pool).

## Quality: why a copy can look worse than the original

A pre-shrunk copy shown small can look worse than the original shrunk by the
browser. Measured 2026-11-16 in headless Chrome at 2x (sRGB and P3 output) on
11 images, each copy compared with Chrome's rendering of the original in the
same slot (scripts were throwaway, in a session scratchpad):

- **A copy barely wider than its slot is softer.** Chrome shrinks images with
  mipmaps and bilinear filtering, not Lanczos
  ([Blink](https://chromium.googlesource.com/chromium/src/+/HEAD/cc/tiles/gpu_image_decode_cache.cc)),
  so a copy shown at 94-99% of its width (a 768 copy in a 726px grid slot)
  came out 10-15% softer than the original; at 78-92%, or at exactly 100%, it
  matched. A lossless copy was just as soft, so this isn't compression. Hence
  the 90% `srcset` descriptors, and tiers that leave room.
- **Lossy WebP halves color resolution** (always 4:2:0), which smears and dulls
  colored text and saturated flat graphics. On a colored-text og:image, WebP
  q80 scored 30.9 dB against the original, AVIF 4:4:4 36.2 dB.
- **Not color profiles, today**: none of the 95 dev originals is Display P3
  (63 sRGB WebP screenshots, 6 PNGs with Apple's Generic RGB, the rest
  untagged), and sharp's sRGB conversion handles those. A synthetic P3 image on
  a P3 screen did look slightly duller converted, so copies keep the profile.
- **Not the kernel or gamma**: lanczos3 vs mitchell made no difference, linear
  light (`.gamma()`) and sharpening both made copies worse, since Chrome does
  neither.

Grid slot (726 device px), averaged over 10 images, against the original:

| copy (768 wide)            | PSNR    | color error | size    |
| -------------------------- | ------- | ----------- | ------- |
| WebP q80 (first prototype) | 32.9 dB | 1.36        | 33.8 KB |
| WebP q90 + smartSubsample  | 33.6 dB | 1.12        | 52.7 KB |
| **AVIF q60 4:4:4**         | 34.0 dB | 0.96        | 26.3 KB |
| lossless WebP              | 35.1 dB | 0.46        | 210 KB  |

**Chosen: WebP quality 90 with smart subsampling.** AVIF 4:4:4 measured a
little better for half the bytes, but encodes ~9x slower (~180 ms per 768 copy), needs ~60 bytes per pixel to encode (it ran prod's
portrait images out of memory), and is heavier for the browser to decode. At
these sizes the bytes don't cost anything (R2 serves for free), so WebP q90 is
the simpler, cheaper choice at nearly the same quality.

## Gotchas found

- `signUpload` encodes a key per path segment: R2 rejects (403) a signed path
  with a percent-encoded `/`.
- Local deployments: `new R2(components.r2)` reads its config when the module
  loads, and the local Node executor keeps modules loaded across `env set`
  ([convex-backend#639](https://github.com/convex/convex-backend/issues/639)).
  Set the R2 env vars before the first push, or restart `convex dev` after
  setting them, or Node actions see an empty R2 config.

## Open decisions

- **The limits**: originals are replaced past 3840 wide or 10 MB, and uploads
  are refused past `MAX_IMAGE_PIXELS` and 30 MB. The pixel limit is set by what
  a Node action can process (Memory, above), not by taste.
- **1x screens**: a grid column up to 460px gets the 512 copy (1.1-1.6x the
  column). Telling the browser the grid is ~1.5x wider (`sizes`) would give 1x
  screens the grid tier too, at more bytes.
- **Tagging, palette and embedding** still download the original and shrink it
  to 1024px themselves (`taggingActions.fetchAndDecode`). They could read the
  2048 copy, but they run alongside the copies being made, so they'd need to
  wait for them or fall back.
