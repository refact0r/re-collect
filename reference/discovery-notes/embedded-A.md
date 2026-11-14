# Embedded-data discovery sources, batch A (website galleries)

Probed 2026-11-05/06 with `curl` (Chrome UA and `curl/8` UA), plus a Node `fetch` pass (undici, the closest match to a Convex action's `fetch`) on every listing URL. 36 hosts probed in total. Scripts are in `/private/tmp/claude-501/-Users-yifan-Documents-re-collect/76f95e82-6be6-46d7-ad4b-819e0c73ee06/scratchpad/embedded-A/scripts/`, one per site (`<site>.py` run with `python3 -I`, or `.mjs` run with `node`). Shared helpers are in `common.py`. `mcheck.sh` checks media hotlinking, `nodefetch.mjs` checks Node fetch, `robots.sh` reads robots.txt.

"Hotlink" means a HEAD/GET with a browser UA, once with no Referer and once with `Referer: https://re-collect.example/`. Resolution was measured with `sips` for images and `ffprobe` for videos.

## Key takeaways

- **Best new finds**
  - **curated.design**: SSR cards with 1600px webp and 1200px mp4. Its sitemap also gives an untokenized 3840x2160 PNG for every site.
  - **inspo.page** (Details.so): an inline JSON blob with 1920px section-clip MP4s and section tags.
  - **siiimple**: WordPress REST API, one post a day.
  - **deadsimplesites**: all 561 cards in a single HTML page.
  - **bestwebsite.gallery**
  - **thefwa.com**: open JSON API, but robots.txt disallows `/api`.
  - **framer.com/community/gallery**: RSC payload, very high volume.
  - **godly.design**: Godly's new combined feed of X motion posts and website cards. It is different from godly.website.
  - **viewportui.com**: curated motion clips sourced from X, with RSS.
- **Walled for server fetch**
  - **saaspo.com**: Cloudflare challenge for every client.
  - **saasframe.io**: curl gets through, but Node fetch and Python get `403 cf-mitigated: challenge`. Treat it as unusable from Convex.
- **Hotlink-protected**: webdesign-inspiration.com and inspo.page return 403 when the Referer is foreign and 200 when there is no Referer. Either set `referrerpolicy="no-referrer"` on `<img>`/`<video>` or copy the media to R2. All other usable sites allow hotlinking.
- **Dead or stale**: httpster (last item 2025-05), typewolf SOTD (2025-12), bentogrids (effectively 2024), supahero (bulk import in Feb 2026, nothing since), navbar.gallery (2026-06), brutalistwebsites (2019), lookup.design (2020-era). cssawards.net is a parked domain and webinteractions.gallery returns 404.
- **Dating tricks for sources without dates** (all used in the scripts):
  - Webflow asset IDs are Mongo ObjectIds; the first 8 hex characters are unix seconds.
  - Prisma cuid: `int(id[1:9], 36)` is milliseconds.
  - UUIDv7 in Framer blob filenames.
  - X status snowflake: `(id >> 22) + 1288834974657` ms.
  - R2/S3 `Last-Modified` header.
  - Upload timestamps embedded in image filenames.
- **Media URL caveats**
  - Vimeo `progressive_redirect` URLs (hoverstat.es) are stable, but they 302 to an expiring CDN token. Store the redirect URL, not the resolved one.
  - Framer gallery videos are Mux HLS only: `/high.mp4` etc. return 404. Use `image.mux.com/<id>/thumbnail.webp` or `animated.webp`, or play with hls.js.
  - curated.design Bunny URLs carry a `token` + `expires` pair about 10 years out, regenerated on each request. Stripping the token gives 403, so store the full URL.
- **cssdesignawards.com** worked at first. About 30 minutes later every connection timed out, from both curl and Node, which looks like IP-level throttling or flakiness. Fetch it rarely.

## Summary table

| site                                                      | data location                                                                                                                                 | items extracted                               | media hotlinkable? / res                                                                                | fresh? / cadence                               | risk                                                                                                 | verdict                                          |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| **curated.design**                                        | Astro SSR cards `div[data-site-card][data-site-id]` (img + `<video data-src>`); `sitemap-content.xml` has lastmod and an untokenized full PNG | 10 (homepage has about 12; sitemap has 2,926) | yes/yes. Card webp 1600x900, mp4 1200x750 (12 s), sitemap PNG 3840x2160                                 | yes (2026-11-02). About 15-40/month            | Bunny tokens (keep the full URL); no date on card (use sitemap lastmod); Pro paywall on filters only | **Great**                                        |
| **inspo.page** (Details.so)                               | `<script type="application/json" data-grid-initial-items>`                                                                                    | 8 unique sites (16 clips)                     | **no-ref only** (foreign Referer gives 403). MP4 1920x1196 plus small mp4 and jpg poster                | yes (2026-11-01). Several/week                 | Bunny hotlink protection; robots.txt 404                                                             | **Great** (section-level video: Hero/Footer/...) |
| **siiimple.com**                                          | WP REST `/wp-json/wp/v2/posts?_embed` (date, tags, full image) + homepage "Visit" links (outbound URL)                                        | 10                                            | yes/yes. JPG 1500x960                                                                                   | yes, **daily** (2026-11-05)                    | none; robots allows all                                                                              | **Great** (minimal)                              |
| **deadsimplesites.com**                                   | SSR HTML (Next RSC) on homepage: all 561 cards, page order = newest first                                                                     | 10 (561 available)                            | yes/yes. R2 jpg 2224x3180 (tall)                                                                        | yes (`lastUpdated 11/04/26`). About 3/week     | 1.8 MB page; robots blocks AI crawlers (ClaudeBot/GPTBot), Content-Signal ai-train=no                | **Great** (personal/minimal)                     |
| **bestwebsite.gallery**                                   | Craft CMS SSR `li[data-slot=site-row]` with `<time datetime>`; detail has full-page PNGs                                                      | 9                                             | yes/yes. Preview PNG 1280x800; `_fullpage_01_desktop.png` on detail                                     | yes (2026-10-14). 1-2/week                     | none                                                                                                 | **Great** (curated since 2008)                   |
| **thefwa.com**                                            | Open JSON `GET /api/winners?per=12&page=1`                                                                                                    | 10 (25 total since relaunch)                  | yes/yes. `/img/<key>?w=1600` gives JPEG 1600x1200 (3 per case); video is a YouTube/Vimeo embed URL only | yes (2026-11-05). 2-3/week                     | **robots disallows `/api`**; homepage is client-rendered, so there is no SSR fallback                | **Great** quality, gray on robots                |
| **framer.com/community/gallery**                          | Next RSC `self.__next_f` then `"fallbackData":{data,pagination}`                                                                              | 10 (64 per page + cursor)                     | yes/yes. Vercel-blob jpg/png 1600x1200; video = Mux HLS (no mp4), poster webp 1600x1200                 | yes (2026-11-04), many per day                 | Framer-only and template-y; `/gallery` 308s to `/community/gallery/`                                 | **OK+** (volume)                                 |
| **godly.design**                                          | SSR `article[data-feed-index]`: X posts (`cdn.godly.design/posts/N.mp4`) and website cards (`/sites/<slug>/thumbnail.webp`, og-image)         | 10 (19 cards)                                 | yes/yes. MP4 1440x1920; thumbnail webp 1000x1250                                                        | yes (2026-10-31)                               | X-sourced media; overlaps godly.website for the website cards                                        | **Great** (if not already ingested via godly)    |
| **viewportui.com** (viewport-ui.design 301s here)         | Astro SSR `article.post-card[data-post-number]` + `/rss.xml` (dates); detail has full mp4 and X link                                          | 10                                            | yes/yes. Post mp4 2538x2160, preview mp4, jpg poster                                                    | yes (2026-10-13). Batches, about 20-40/month   | X-sourced; robots blocks AI crawlers                                                                 | **OK+** (motion UI)                              |
| **admiretheweb.com**                                      | Nuxt 2 static `/_nuxt/static/<build>/payload.js` (`__NUXT_JSONP__`, evaluated in `vm`); detail page has outbound URL and `datePublished`      | 10                                            | yes/yes. JPG 2000x1250 (imgix-style `?w=&h=` gives avif)                                                | yes (2026-10-29). Weekly batches of about 5    | payload needs JS eval; fallback is homepage cards + 10 detail fetches                                | **Great**                                        |
| **footer.design**                                         | Webflow SSR `.gallery_item.w-dyn-item` (date = ObjectId)                                                                                      | 10 (26)                                       | yes/yes. AVIF 2028x1352 thumb, desktop avif on detail                                                   | yes (2026-11-04). 1-2/week                     | none                                                                                                 | **OK** (footers only)                            |
| **webdesign-inspiration.com**                             | `/feed` RSS (list, date, full PNG) + detail page (`data-l` base64 outbound URL, `.c-chip` tags)                                               | 8 (RSS also carries blog posts)               | **no-ref only** (foreign Referer gives 403). PNG 1408x889                                               | yes (2026-11-05). Several/week                 | hotlink protection; `curl/8` UA gets 403 (Node fetch fine)                                           | **OK** (broad, SaaS-heavy)                       |
| **cssdesignawards.com**                                   | SSR `article.single-project` (date from `cdasites/YYYY/YYYYMM/YYYYMMDDhhmmss.jpg`)                                                            | 10                                            | yes/yes. Card 720x436, detail 1068x646                                                                  | yes, daily nominees                            | **connection timeouts** after a few fetches (Node and curl)                                          | **OK** (overlaps Awwwards)                       |
| **sitesee.co**                                            | Next RSC records `{"id":..,"screenshot_url":..}`                                                                                              | 10                                            | yes/yes. CloudFront webp 1280x800                                                                       | borderline (2026-09-28). Batches               | robots disallows `/api` (not used)                                                                   | **OK** (fun/indie)                               |
| **bestfolios.com** (use **www**; apex has a bad TLS cert) | Open JSON `GET /api/portfolios` (AngularJS SPA)                                                                                               | 10 (100)                                      | yes/yes. S3 `-origin.jpeg` 2360x1194, `-large` 1400x708, mobile                                         | borderline (2026-09-10). 2-4/month             | robots.txt returns SPA HTML                                                                          | **OK** niche (portfolios)                        |
| **uiland.design/explore**                                 | `__NEXT_DATA__.props.pageProps.initialItems` (+ cursor)                                                                                       | 10 (36)                                       | yes/yes. R2 mp4 up to 2868x2160 (20 s) + poster                                                         | **very** fresh (dozens/day)                    | re-hosted X clips (copyright murky); robots blocks AI crawlers; uneven quality                       | **OK** (firehose)                                |
| **hoverstat.es**                                          | Gatsby `/page-data/index/page-data.json` (also `/rss.xml`)                                                                                    | 10 (25)                                       | yes/yes. Vimeo progressive mp4 1280x720/1080p; Vimeo thumb 640x360 (`d_1920x1080` works)                | **stale-ish** (2026-07-21, 3.5 months). Bursty | Vimeo redirect to expiring token (store the redirect URL)                                            | **OK** (great motion picks, irregular)           |
| **cta.gallery**                                           | Framer SSR cards `a[href^="./cta/"]` + framerusercontent img                                                                                  | 10 (40 unique)                                | yes/yes. JPG 1208x556 (CTA section crop)                                                                | unknown (no dates; 523 in sitemap)             | no dates (diff slugs to detect new)                                                                  | **Skip/OK** niche                                |
| **interfaceingame.com** (bonus)                           | WP REST `/wp-json/wp/v2/media` and `/games`                                                                                                   | 10                                            | yes/yes. PNG 1920x1080                                                                                  | yes (2026-11-01). Weekly                       | none                                                                                                 | **OK** niche (game UI, not websites)             |
| navbar.gallery                                            | Webflow SSR `.work_item.w-dyn-item`                                                                                                           | 10 (13)                                       | yes/yes. AVIF 3554x2010                                                                                 | **no** (2026-06-06)                            | `cdn.navbar.gallery` failed with this Mac's system resolver (dig fine; local quirk)                  | Skip (stale)                                     |
| bentogrids.com                                            | `__NEXT_DATA__.props.pageProps.shots` + `s.bentogrids.com/{id}.{fmt}`, `v.bentogrids.com/{id}.mp4`                                            | 10 (286)                                      | yes/yes. PNG 2232x1628, mp4 2400x1302                                                                   | **no** (280 of 286 from 2024; 1 in 2026)       | none                                                                                                 | Skip (dead)                                      |
| supahero.io                                               | SSR/RSC cards `a[href^="/hero/"]` (R2 webp)                                                                                                   | 10 (573)                                      | yes/yes. Webp 2153x2294                                                                                 | **no** (all R2 objects dated 2026-02-12)       | none                                                                                                 | Skip (stale)                                     |
| httpster.net                                              | SSR `article.Preview[data-date]`, `/websites.json`                                                                                            | 10                                            | yes/yes. 300px thumb, 1800x1125 on detail                                                               | **dead** (2025-05-26)                          | n/a                                                                                                  | Skip                                             |
| typewolf.com/site-of-the-day                              | SSR `.item` + `/feed`                                                                                                                         | 9                                             | yes/yes. PNG 984x590                                                                                    | **dead** (2025-12-14)                          | Chrome UA got a TCP reset once                                                                       | Skip                                             |
| saasframe.io                                              | Webflow SSR (would work)                                                                                                                      | 0                                             | n/a                                                                                                     | n/a                                            | **CF challenge for Node fetch/Python** (curl passes)                                                 | Skip (walled)                                    |
| saaspo.com                                                | n/a                                                                                                                                           | 0                                             | n/a                                                                                                     | n/a                                            | **CF "Just a moment" for all clients**                                                               | Skip (walled)                                    |
| nicelydone.club                                           | `__NUXT_DATA__` has only categories; screens are client-side/paywalled                                                                        | 0                                             | n/a                                                                                                     | n/a                                            | paywall                                                                                              | Skip (Mobbin overlap)                            |
| pageflows.com (screenlane.com 301s here)                  | static marketing HTML; flows paywalled                                                                                                        | 0                                             | n/a                                                                                                     | n/a                                            | paywall                                                                                              | Skip                                             |
| designvault.io (301s to screensdesign.com)                | SSR mobile-app library (`media.screensdesign.com`)                                                                                            | not extracted                                 | n/a                                                                                                     | n/a                                            | mobile apps, out of scope                                                                            | Skip (Mobbin overlap)                            |
| lookup.design                                             | client-only Next, `pageProps: {}`; assets from 2020                                                                                           | 0                                             | n/a                                                                                                     | dead                                           | n/a                                                                                                  | Skip                                             |
| brutalistwebsites.com                                     | static HTML, 1,599 imgs                                                                                                                       | not extracted                                 | yes                                                                                                     | **dead** (newest img Last-Modified 2019)       | n/a                                                                                                  | Skip                                             |
| cssawards.net                                             | parked domain (`/lander` redirect)                                                                                                            | 0                                             | n/a                                                                                                     | n/a                                            | n/a                                                                                                  | Skip                                             |
| webinteractions.gallery                                   | 404                                                                                                                                           | 0                                             | n/a                                                                                                     | dead                                           | n/a                                                                                                  | Skip                                             |
| recent.design                                             | already covered                                                                                                                               | skipped                                       |                                                                                                         |                                                |                                                                                                      |                                                  |
| ui-patterns.com, scrnshts.club                            | status only (200); not relevant (pattern docs / app-store shots)                                                                              | skipped                                       |                                                                                                         |                                                |                                                                                                      |                                                  |
| webbyawards                                               | skipped as irrelevant                                                                                                                         |                                               |                                                                                                         |                                                |                                                                                                      |                                                  |

**Node fetch check** (Chrome UA and a bot UA `re-collect/1.0`): every usable listing URL above returned 200 with both UAs. The exceptions are saasframe and saaspo (403 challenge) and cssdesignawards (connect timeout). No site varies by UA except webdesign-inspiration, which blocks the literal `curl` UA.

## robots / terms one-liners

- curated.design: allows `/`, disallows `/api/` (except `/api/sections/`). We use HTML and sitemap only.
- siiimple: `Disallow:` (empty, so everything allowed). Sitemap listed.
- deadsimplesites, uiland, viewportui, nicelydone: Cloudflare managed robots. Search allowed; `Content-Signal: ai-train=no, use=reference`; blocks ClaudeBot, GPTBot, CCBot etc.
- bestwebsite.gallery: only CMS internals disallowed.
- thefwa.com: allows `/`, **disallows `/api`**, `/admin`, short-link paths.
- framer.com: allows `/`; disallows `?sort=`, `?query=` and similar query params, plus `/api-proxy`.
- webdesign-inspiration: `Allow: /` (only reachable with a browser UA).
- admiretheweb: allows; disallows account, search and saved pages.
- cssdesignawards: only `DotBot` blocked.
- footer.design, cta.gallery, godly.design, pageflows: allow all.
- sitesee: disallows `/api`, `/admin` and user pages.
- bentogrids: disallows two template pages only.
- hoverstat.es, httpster, inspo.page: no robots.txt (404).
- Footers: hoverstat.es and cta.gallery both say screenshots are © their respective owners. Nobody publishes an API or terms for third-party reuse. Everything here is "public page data, use at personal scale".

## Examples (2 per usable site)

Format: title, original URL (ref stripped), media (type, res), tags, date.

**curated.design** (`curated.py`)

1. Pendictive: https://pendictive.com/
   - image `https://curated-images.b-cdn.net/objects/9f18…/retina-v1/card-image-1600.webp?token=…&expires=2109291788` (1600x900)
   - video `https://curated-video.b-cdn.net/objects/ed7d…/retina-v1/card-video-1200.mp4?token=…` (1200x750, 12 s)
   - sitemap PNG `https://marketstorage.b-cdn.net/previews/288d99ae-…/pendictive.com_.png` (3840x2160)
   - tags (detail page): education, minimal, writing-platform
   - date: sitemap lastmod 2026-11-02
2. Krea 3: https://www.krea.ai/krea-3
   - image card-image-1600.webp (1600x900) + video card-video-1200.mp4
   - date: 2026-11-02

**inspo.page** (`inspo_page.py`)

1. Eladio Dieste: https://www.eladiodieste.com/
   - video `https://inspiration-library.b-cdn.net/inspo-video/big-eladiodieste-1793528160222-19911.mp4` (1920x~1196)
   - small mp4 + poster jpg
   - tags: Architecture, Footer, Portfolio
   - date: 2026-11-01T10:17Z
2. Littlebird: https://littlebird.ai/
   - video big-littlebird-1793526674960-23413.mp4 + poster
   - tags: AI, Footer
   - staff pick; date: 2026-11-01T09:51Z

**siiimple** (`siiimple.py`)

1. Luxury Train Tickets: https://www.luxurytraintickets.com/
   - image `https://siiimple.com/wp-content/uploads/2026/08/luxury-train-tickets.jpg` (1500x960)
   - tags: Dark, Luxury, Travel Agency
   - date: 2026-11-05T15:09Z
2. Clinton Henry: https://clintonhenry.com/
   - image `…/2026/08/clinton-henry.jpg` (1500x960)
   - tags: Company, Radio & Podcasts, Typography
   - date: 2026-11-04T15:02Z

**deadsimplesites** (`deadsimplesites.py`)

1. Patrik Arvidsson: https://patrikarvidsson.com/
   - image `https://pub-199cbbb8716c47d894e05d31fd02edfe.r2.dev/images/623.jpg` (2224x3180)
   - no tags or date on card (newest-first order)
2. Nick Hiotis: https://www.hiotis.com/
   - image `…/images/622.jpg`

**bestwebsite.gallery** (`bestwebsite_gallery.py`)

1. Sketch: https://www.sketch.com/
   - image `https://static.bestwebsite.gallery/assets/gallery_bestwebsite/images/sketch-com_2026-10-14_preview.png` (1280x800)
   - full-page `…_fullpage_01_desktop.png` on detail
   - tags: The Netherlands
   - date: 2026-10-14T21:55+02:00
2. Hold: https://grabhold.now/
   - image `…/grabhold-now_2026-10-07_preview.png` (1280x800)
   - tags: United Kingdom
   - date: 2026-10-07

**thefwa.com** (`thefwa.py`)

1. Garuda 2026: The Locker Room: https://garuda2026.offwg.com/
   - images `https://thefwa.com/img/submissions/ba7dda8a-…/1-6185efdd-….webp?w=1600` (JPEG 1600x1200), 3 images
   - tags: Website, judged, fotd_worthy
   - credits: SCREENAGERS
   - date: 2026-11-05 05:30
2. Adrien Quéchon 2026 Website: https://adrienquechon.com/
   - 3 images
   - tags: Website, judged
   - date: 2026-11-04 05:18

**framer.com/community/gallery** (`framer_gallery.py`)

1. ZOE FELDMAN DESIGN: https://www.zoefeldmandesign.com/
   - image `https://y4pdgnepgswqffpt.public.blob.vercel-storage.com/media/3d397eaa-…/01a1a8db-2c49-71cb-….png`
   - author: Kyle Duncan
   - date: 2026-11-04T23:18Z (UUIDv7)
2. The Club Madrid: https://www.theclubmadrid.com/
   - video `https://stream.mux.com/Z600jdBD….m3u8` (HLS)
   - poster `https://image.mux.com/Z600…/thumbnail.webp?time=11.3` (1600x1200)
   - animated preview `…/animated.webp?width=640`

**godly.design** (`godly_design.py`)

1. Raksha T (X post): https://x.com/rakshaa_t/status/2116543742970843400
   - video `https://cdn.godly.design/posts/624.mp4` (1440x1920, 12.7 s)
   - date: 2026-10-31T14:52Z (snowflake)
2. Cofounder (website card): https://godly.design/website/cofounder
   - image `https://cdn.godly.design/sites/cofounder/thumbnail.webp` (1000x1250), plus `og-image.png`
   - outbound URL on detail page

**viewportui.com** (`viewportui.py`)

1. Stamps in motion (@cambreedesigns): https://x.com/cambreedesigns/status/2109753196046631184
   - video `https://viewportui.com/_astro/x.com_PTB-9BPGs5ITRR0v.post.D4a-t243.mp4` (2538x2160, 6.4 s)
   - preview mp4 + poster jpg
   - date: 2026-10-13T19:09Z
2. QR Code concept (@SolutionB2u): https://x.com/SolutionB2u/status/2109424625742713341
   - post mp4 + poster
   - RSS description includes style tags (Mobile, iOS, experimental, playful)
   - date: 2026-10-13T19:07Z

**admiretheweb.com** (`admiretheweb.mjs`)

1. David McGillivray: https://dmcg.co/
   - image `https://assets.admiretheweb.com/wp-content/uploads/2026/10/atw-dmcg.jpg` (2000x1250)
   - tags: light, minimal, Photography, white, whitespace
   - date: 2026-10-29
2. Cursor Compile: https://cursor.com/compile
   - image `…/atw-cursor-compile-scaled.jpg`
   - tags: colourful, conference, Event, illustration, large type …
   - date: 2026-10-29

**footer.design** (`footer_design.py`)

1. Tactile UI: https://tactileui.dev/
   - image `https://cdn.prod.website-files.com/64fe1f9c06690a6cee3471ec/6aeb5791c57a45fd51991336_tactileui-thumbnail.avif` (2028x1352)
   - date: 2026-11-04 (ObjectId)
2. Better Call Quang: https://www.quangdinh.im/
   - avif thumb
   - Editor's Choice
   - date: 2026-11-03

**webdesign-inspiration.com** (`webdesign_inspiration.py`)

1. AITDK: https://aitdk.com/extension
   - image `https://www.webdesign-inspiration.com/media/screenshots/i2/65898/images/main-65898.png` (1408x889; no-Referer only)
   - tags: B2B, Clean, Icons, Landing page, Minimalist, SaaS, Purple…
   - date: 2026-11-05T15:34Z
2. Eertmoed Studio: https://eertmoed.studio
   - image `…/65901/images/main-65901-20261103-212833.png`
   - tags: Agency, Portfolio, Typography, Minimalist…
   - date: 2026-11-03

**cssdesignawards.com** (`cssdesignawards.py`)

1. Loopsii: https://loopsii.com/cssda (the `/cssda` path is the site's own, not a ref param)
   - image `https://www.cssdesignawards.com/cdasites/2026/202611/20261105140407.jpg` (720x436); detail 1068x646
   - tags: NOMINEE
   - date: 2026-11-05
2. Vitrine - Vol.02: https://vitrine.4wide.jp/
   - tags: NOMINEE
   - date: 2026-11-05

**sitesee.co** (`sitesee.py`)

1. Island: https://getisland.app
   - image `https://djt888zcr9vad.cloudfront.net/island-screen-time-1790632312227.webp` (1280x800)
   - tags: app, white, green, black, gray
   - date: 2026-09-28
2. Bulletlist: https://bulletlist.org/
   - webp
   - tags: resource + shades
   - date: 2026-09-07

**bestfolios.com** (`bestfolios.py`)

1. Elaine Yu: https://www.elaineyu.design/
   - image `https://s3-us-west-1.amazonaws.com/bestfolis/XQv7ieMyA7m_JJsM4JA7M0o2-origin.jpeg` (2360x1194) + mobile
   - tags: UX Design, Student, Intern, IBM, Duke
   - date: 2026-09-10
2. Kiara Di Gregorio: https://kiaradigregorio.com/
   - tags: Graphic Design
   - date: 2026-09-01

**uiland.design/explore** (`uiland_explore.py`)

1. "Genie style menus": https://x.com/imharshin/status/2118343243092070523
   - video `https://pub-ffc481b6db77465298d1b1eb26a7c32c.r2.dev/inspirations/3f9ac0db-…/twitter/1793912344506-0.mp4` (2868x2160, 20.5 s) + poster
   - date: 2026-11-05T20:59Z
2. "Card declined, but nicely": https://x.com/dev_ya/status/2118378209863672036
   - video 1200x1200 + poster
   - date: 2026-11-05

**hoverstat.es** (`hoverstates.py`)

1. Soft Labor: https://www.softlabor.biz/
   - video `https://player.vimeo.com/progressive_redirect/playback/1211360526/rendition/720p/file.mp4%20%28720p%29.mp4?loc=external&oauth2_token_id=…&signature=…` (1280x720, 30 s)
   - 360p loop + Vimeo poster 640x360
   - credits: Other Means
   - date: 21 Jul 2026
2. XK Studio: https://xk.studio/
   - 1080p progressive mp4 + 360p + poster
   - date: 20 Jul 2026

**cta.gallery** (`cta_gallery.py`)

1. Safds: https://safds.com/
   - image `https://framerusercontent.com/images/LmhHMkZI9nWA9Uk7ff0QcATkU.jpg` (1208x556)
   - detail tags: Modal / Pop-up, Agency, Light
   - no date
2. Tryclucky: https://tryclucky.com/
   - jpg 1208x556

**interfaceingame.com** (`interfaceingame.py`)

1. Binocular – Resident Evil Requiem (game UI)
   - image `https://interfaceingame.com/wp-content/uploads/resident-evil-requiem/resident-evil-requiem-binocular.png` (1920x1080)
   - date: 2026-11-01
2. Save Game – Resident Evil Requiem
   - PNG 1920x1080
   - date: 2026-11-01

Scripts for the stale or skipped sites also exist and run: `httpster.py`, `typewolf.py`, `navbar_gallery.py`, `bentogrids.py`, `supahero.py`. `saasframe.py` only runs when curl's TLS fingerprint gets through.

## Notes for implementation

- **No browser needed anywhere** in the usable set. The patterns, in order of robustness:
  1. Open JSON: FWA, bestfolios, hoverstat.es page-data, WP REST on siiimple and interfaceingame.
  2. Inline JSON: inspo.page, uiland `__NEXT_DATA__`.
  3. RSC string concatenation (`self.__next_f.push([1,"…"])`, then `JSON.parse` of each chunk, then `raw_decode` from a key): framer, sitesee.
  4. Regex over SSR cards: curated, deadsimplesites, bestwebsite, footer, godly.design, viewportui, cssda.
  5. RSS plus a detail page: webdesign-inspiration, viewportui.
- **admiretheweb** needs `vm.runInNewContext` (Node action) to evaluate `payload.js`. In the default Convex runtime, use the cards + detail-page path instead.
- **Dedup with big galleries**: many items cross-post. Inspo, curated and Framer all had Eladio Dieste or similar studio sites in the same week, and FWA/CSSDA overlap Awwwards. Dedup on normalized host + path.
- **Hotlink policy**: render with `referrerpolicy="no-referrer"` globally. That covers webdesign-inspiration and inspo.page. Copy to R2 anything we keep, since several URLs are tokenized (curated, Vimeo) or could rotate.
