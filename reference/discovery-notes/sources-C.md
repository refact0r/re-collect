# Discovery-feed source probe: batch C (probed 2026-11-04)

Method: `curl` with a desktop Chrome 141 UA and with the default curl UA, plus robots.txt, sitemap and feed paths, inspection of embedded hydration data and JS bundles, and CDN hotlink checks with a foreign `Referer`. "Plain fetch OK" means a Convex action `fetch` can do it without a browser.

---

## 1. Godly → now **Recent** (recent.design)

- **Status:** godly.website returns a 301 to `https://recent.design/?ref=godly`. Godly has rebranded as Recent. It is no longer only a website gallery. The home feed mixes sites, X posts, interface and motion clips, branding, posters, OG images, launch videos, app icons and App Store screenshots. `/websites` is the sites-only view.
- **Access method (best route):** plain HTML fetch. The site is built on TanStack Start (`$_TSR`). The page includes a dehydrated **seroval** payload with full item objects. It is JS-literal syntax, not strict JSON: `$R[16]={id:"erz4438",slug:"augen",title:"Augen",format:"site",category:{slug:"health",…},source:{type:"website",url:"https://augen.pro/?ref=godly",…},media:[…],createdAt:1783141568474}`. Regex extraction works. A safer option is to parse `/i/<id>-<slug>` detail pages, which carry og tags plus the same payload.
  - There's no RSS or Atom feed, and `/feed`, `/rss*` and `/api` all return 404.
  - `sitemap.xml` has 1,275 URLs, 1,263 of them `/i/…` items, with lastmods. The lastmods are weighted toward Oct 2026 by what looks like a bulk re-touch, so use `createdAt` for dates.
- **Bot protection:** Cloudflare sits in front, but there was no challenge. Chrome UA returned 200 and plain curl followed the 301 normally. robots.txt allows `*` and sets Content-Signal `search=yes, ai-train=no`. It blocks AI crawlers (GPTBot, ClaudeBot, CCBot and others), which doesn't affect a personal fetcher with a browser UA.
- **Entry fields:** title, format (`site`/`tweet`/…), category (e.g. health, interface, motion), **original URL** (`source.url`, with `?ref=godly` appended, so strip it), source favicon, `createdAt`, and a description from the og/meta description. Media is on `cdn.recent.design` and is **hotlinkable**: 200 with a foreign Referer, `cache-control: immutable`.
  - Video is **MP4 (H.264)** at several sizes: `items/<id>/website/recording/{480,720,1080,1440}.mp4`, around 1.5 MB at 720p. Some items also have a `3840x2160.mp4`.
  - Posters are WebP: `…/recording/poster/{360,640,960,1280}.webp`.
  - There's also an og PNG.
  - **Example:** Augen → https://augen.pro, category Health, created 2026-07-04. Video: `https://cdn.recent.design/items/erz4438/website/recording/720.mp4`. Poster: `…/poster/1280.webp`.
- **Volume & cadence:** about 1,260 items in the archive. The home feed shows multiple new items daily, for example 8 dated 2026-11-04 and 30+ dated 2026-11-03 among visible createdAt stamps. My estimate is roughly 5–15 items/day across all formats, with fewer that are actual websites.
- **ToS risk:** there's no terms page (`/terms`, `/tos` and `/legal` all return 404). The only stated restriction is the robots Content-Signal, which forbids ai-train. Low risk for personal, non-redistributed use.
- **Overlap:** high for websites, since Godly was the reference gallery others copy from. Its new formats (X posts, motion and interface clips, launch videos) add variety.
- **Verdict: Great.** It's the best-quality source in this batch: curated, current, with a structured payload, original URLs and hotlinkable MP4s. The trade-off is that you need to parse the TanStack/seroval blob, which is a scraping contract that could break.

---

## 2. Mobbin (mobbin.com/browse/web/apps)

- **Status:** `/browse/web/apps` returns a 307 to `/discover/apps/web`. The site is Next.js App Router on Vercel.
- **Access method:** **official REST API** and **MCP** (`https://api.mobbin.com/mcp`, OAuth), documented at https://docs.mobbin.com. REST is **Team/Enterprise only**, using workspace bearer keys. MCP needs Pro or above. Both are limited to 60 requests per 60 s. On the free plan, the public discover page includes RSC (`self.__next_f`) data. It has app names, logos (Supabase public storage) and preview screen images on `bytescale.mobbin.com`, which are encrypted-param URLs that fetched fine (200 WebP). There's no RSS. sitemap.xml exists but lists marketing and community pages.
- **Bot protection:** none on the landing page. Vercel returned 200 for Chrome and a 307 redirect for plain curl. robots.txt allows `*`. GPTBot is blocked except for `.md` docs.
- **Entry fields (public):** app name, logo, a few preview screens (up to 1920w WebP). Flows, search, filters and most screens need login. The free plan is "Limited" apps, with **no flows, no search**, per `pricing.md`. Pro costs about $10/mo yearly. Original app link and dates aren't present in the public data.
  - **Example:** Telegram, logo `ujasntkfphywizsdaapi.supabase.co/storage/v1/object/public/content/app_logos/f106f843-….webp`, with screens on bytescale.
- **Volume & cadence:** a large, continuously updated library, but you can't see per-item dates without login.
- **ToS risk:** **High.** The terms ban using a "scraper, robot, bot, spider, crawler" (paraphrased) to access or copy content, and ban mirroring or re-hosting retrieved content. Bots must follow robots.txt.
- **Overlap:** unique, since it's real shipped product UI (screens and flows) rather than marketing sites. It's reference material, not a "feed".
- **Verdict: Skip for scraping.** It's OK only if you pay for Pro and use MCP or Team plus the REST API. The content is valuable for UI patterns, but it's paywalled, the ToS forbids scraping, and it doesn't work as a discovery stream.

---

## 3. a-fresh.website

- **Access method:** plain HTML scraping. It's built with Ycode (a no-code tool) on Next.js/Vercel. The listing is server-rendered with `<img alt="X landing page" src="/a/<id>/<slug>-t.webp?width=…">` and `/websites/<slug>` links. Detail pages carry the original link as `https://site.com/?ref=a-fresh.website`, plus a full-page desktop image `<slug>-d.webp`. There's no RSS. sitemap.xml has 3,713 URLs: about 1,030 websites, 1,028 components, plus fonts, pages and emails. Every lastmod is 2026-07, which is a build stamp.
- **Bot protection:** none. Vercel returned 200. Plain curl got a 301 to www, then worked. robots.txt only disallows `/ycode/`.
- **Entry fields:** title, thumb and full-page screenshot (served from their own domain, hotlinkable, 200 with a foreign Referer), original URL, tag and category pages (`/websites/ai`, `/dark`, `/minimal`, `/framer`, …). There's no visible date.
  - **Example:** Amby, `https://www.amby.com/?ref=a-fresh.website`, thumbnail `https://www.a-fresh.website/a/786LZhtU3yntOtGY9OGV9P/amby-t.webp?width=1920&quality=85`.
- **Volume & cadence:** **looks stale.** The homepage's top items (viacheslav-novoseltsev, proofmode, ossou, amby, yuumae, kalstore, …) are identical to the Wayback snapshot from 2026-03-08. I found nothing new in 8+ months. There's a $72/yr "all-access" paywall for part of the archive.
- **ToS risk:** low-medium. The privacy/terms page says it doesn't own copyright to the featured designs. I found no explicit scraping clause, and the paywalled content is off-limits.
- **Overlap:** heavy with Land-book, Lapa and SaaS-landing galleries (generic SaaS and ecommerce landing pages).
- **Verdict: Skip.** It's stale, middling SaaS-landing-page taste, and duplicates Land-book.

---

## 4. Unbound by default (unboundbydefault.com)

- **Access method:** plain HTML or the Next.js RSC payload. The home page's RSC has `projects:[{title, slug, projectDetails:{transformedVideo:{mp4Resized}, thumbnail:{poster}}}]`. Detail pages `/website/<slug>` include JSON-LD (`datePublished`), tags, credits, the original link (`<url>?ref=unboundbydefault`) and an `hlsUrl`. The data looks like it comes from WPGraphQL (`projectDetails`). There's no RSS. sitemap.xml has 145 URLs, of which only **100 are websites**.
- **Bot protection:** none. Vercel returned 200 for both UAs. robots.txt only disallows `/api/`, `/auth/`, `/bookmarks` and `/profile`.
- **Entry fields:** title, original URL, poster JPG (own domain, hotlinkable), and tags in four groups: style (minimal, 3d, parallax…), industry, interaction (smooth-scroll, page-transitions…) and built-with (next-js, lenis…). Also fonts, credits (designer/dev) and datePublished.
  - Video is on Bunny Stream (`vz-6998eb25-bee.b-cdn.net/<uuid>/play_240p.mp4`, `play_720p.mp4`, plus an HLS `playlist.m3u8` with 360p, 480p and 720p H.264). **It's referer-protected:** an empty Referer gets a 403 and any Referer gets a 206. Browser hotlinking from our domain would probably work, while a server fetch needs a Referer header.
  - **Example:** Aliyah Adefolake → https://aliyahadefolake.com, published 2026-10-05, tags creative/design, page-transitions, smooth-scroll, built with Next.js and Lenis. Poster: `https://unboundbydefault.com/poster/724bdc37-08d9-4331-8840-b015980f8e66.jpg`.
- **Volume & cadence:** tiny and sporadic. About 100 sites total. Sampled publish dates cluster in 2023-05 to 2023-08 and 2024-08 to 2024-10, then a batch on 2026-10-05. That's about 0–2 per week on average, in bursts.
- **ToS risk:** low. The privacy page has generic "by accessing you agree" terms and no scraping clause.
- **Overlap:** high. These are Awwwards/Godly-style portfolio and agency sites.
- **Verdict: Skip, or a one-time import at most.** The tagging is good (interaction and built-with), but 100 items that grow in bursts isn't a feed. A one-time backfill import would be fine.

---

## 5. Layers (layers.to)

- **Status:** `/` returns a 302 to `/explore`. It's a Remix app on CloudFront.
- **Access method:** **undocumented JSON API.** `GET https://layers.to/api/v1/layers?take=N` works anonymously **if you send `Referer: https://layers.to/explore`**, and returns 401 without it. The UA doesn't matter.
  - The response looks like `{data:[…], pagination:{nextCursor, hasMore}}`, and you paginate with `cursor=`.
  - The default sort is newest. `view=top` returns all-time top. The UI also has hot/rising/new and timeframes (hour/day/week/month/year), and its `sort` param is JSON `{field, direction}`. I didn't fully map the timeframe param.
  - The SSR HTML has no post data (loader returns null). There's no RSS or sitemap, and robots.txt returns 404.
- **Bot protection:** none, beyond the Referer check on the API.
- **Entry fields:** id, title, description (often empty), `imageUrl` (PNG/JPG or **MP4**, on S3 `layers-uploads-prod.s3.eu-west-2.amazonaws.com`, publicly readable), imageWidth/Height, posterUrl, createdAt, user (username, name, avatar), groups and tags (mostly empty). There's **no original site link**, because these are user-uploaded shots.
  - **Example:** "Mckp • Ordonaas" by user `hametha096z7gx841pvms`, 1608×1208 PNG, created 2026-11-04T16:41Z, `https://layers-uploads-prod.s3.eu-west-2.amazonaws.com/88b9c9a2-…--Mckp-Ordonaas.png`.
- **Volume & cadence:** high. 18 of the latest 20 posts are from today, so roughly 20–50+/day.
- **ToS risk:** medium-low. `/legal` exists, but I found no scraping clause in the SSR text. The undocumented API could change at any time. The content is user-posted, so copyright belongs to individual creators.
- **Overlap:** low with galleries. It's a Dribbble-style social feed of designer shots.
- **Verdict: OK at best, and only with `view=top`.** The newest-first feed is Dribbble-tier noise ("Day 212 of Daily UI", finance dashboards, "Create project"). If used, pull top or hot weekly with a like threshold.

---

## 6. Land-book (land-book.com)

- **Access method:** **RSS** at `https://land-book.com/rss.xml`. It's the only path that gets through. It returns 200 for both the Chrome UA and plain curl, with 50 items, each having title, pubDate, a link to the land-book detail page and an `<img>` in the description. Everything else (home, `/websites`, `/sitemap.xml`, `/feed`, `/terms`, detail pages) returns **403 with a Cloudflare managed challenge** (`cf-mitigated: challenge`, "Just a moment..."), including with a Googlebot UA.
- **Bot protection:** Cloudflare managed challenge on all HTML. RSS and robots.txt are exempt. robots.txt welcomes AI crawlers but disallows `/api/`, `?search=`, `?sort=` and others. The Cloudflare Browser Rendering worker might be challenged too, which I didn't test.
- **Entry fields (RSS):** title (the featured site's own `<title>`), pubDate, land-book link, and a thumbnail served by Thumbor on `cdn.land-book.com`. It's 600 px wide and signed, so you can't change the size without the signature. However, the **unsigned raw path `https://cdn.land-book.com/website/<id>/<hash>-screenshot.jpg` returns the full-page original** (example: 4.5 MB JPEG) and is hotlinkable.
  - **No original site URL in RSS**, and no tags or colors, because the detail pages that have them are behind the challenge. To get the URL you'd need a browser, or a search on the title, or a screenshot of our own.
  - **Example:** "Symmetry AI — The Work Finds Itself and Gets Done", 2026-11-04 09:38, `https://land-book.com/websites/102075-symmetry-ai-…`, image `https://cdn.land-book.com/website/102075/930ba6359dab06a1-screenshot.jpg`.
- **Volume & cadence:** about 5 per weekday (50 items spanning 2026-10-21 to 11-04), so roughly 25/week. Very consistent.
- **ToS risk:** unknown, because `/terms` is behind the challenge. Using the published RSS is low risk.
- **Overlap:** very high. It's the canonical "landing-page gallery" (SaaS, Framer/Webflow templates, freelancers), with some template-marketplace spam ("Noura - Webflow HTML website template", "Fourlines … Framer Template").
- **Verdict: OK.** RSS makes ingestion trivial and steady. Taste is mid and there are template ads mixed in, so filter titles containing "template". The main gap is the missing original URL.

---

## 7. Spotted in Prod (spottedinprod.com)

- **Status:** `/` returns a 307 to `/clips`. It's Next.js (Turbopack) on Vercel. It focuses on **iOS app interactions** (screen-recorded clips).
- **Access method:** **public unauthenticated JSON APIs**, found in the JS bundles. All returned 200 for both the Chrome UA and plain curl:
  - `GET /api/posts/paginated?page=1&limit=100` returns `{posts:[…], total:309}`. These are the editorial clips. A limit of 1000 gave a 400, so page through.
  - `GET /api/posts` returns 50 posts in seeded random order. The page param is ignored.
  - `GET /api/posts/filters` returns 332 apps (name, App Store `link`, tags) plus tag taxonomy.
  - `GET /api/feed/today` returns the daily featured item (`date`, `publishedAt`, items with mediaUrl).
  - The `/clips` HTML also has a dehydrated react-query state with community clips (`total: 1175`, cursor pages). There's no RSS and no sitemap. robots.txt returns 404 (none), and the page sets `noindex`.
- **Bot protection:** none.
- **Entry fields:**
  - Editorial: `displayName`, `appName`, appId (which joins to the App Store link through filters), tags typed as gesture, visual, flow, pattern and design_language (e.g. `gesture:tap, flow:messaging, pattern:expandcollapse, design_language:silly`), createdAt, recordedAt, saveCount, curator, blurhash, `videoName`, `gridVideoName` and `posterName`. These resolve to `cdn.spottedinprod.com/clips/<name>`, served as **MP4** and hotlinkable (206 with a foreign Referer).
  - Community clips: title, description, clipType (prototype/app), subtype (figma…), MP4 (transcoded, e.g. 1320×2868, ~7 s), WebP poster, owner.
  - **Example:** "Voice message" in app _abode_, tags tap, emoji, messaging, expandcollapse, confetti, waveform, created 2025-07-08, video `https://cdn.spottedinprod.com/clips/95604326-a8b7-4907-80db-ea469cf6bd28.mp4`. App link example: Acme Weather → `https://apps.apple.com/app/id6742032583`.
- **Volume & cadence:** 309 editorial posts. 2026 runs about 4–40/month (Sept 20, Oct 12). There's a daily featured item, the last on 2026-10-30. Community clips add more (1,175 total).
- **ToS risk:** low-medium. `/terms` exists, but I found no scraping clause in the SSR text. The APIs are undocumented. There's a Stripe membership, but `isLocked` was false for all 110 sampled posts.
- **Overlap:** **unique.** It's iOS micro-interaction video, which none of the website galleries cover.
- **Verdict: Great** if the user wants motion and interaction inspiration. It has clean JSON, rich typed tags and hotlinkable MP4s. It's mobile-only (iOS), not web.

---

## 8. loadmo.re

- **Access method:** plain HTML scraping. It runs on Kirby CMS (Apache). Listing pages are `https://loadmo.re/page:N` (pages 1–13, about 30 posts each, so ~386 posts total). Each card has `<a href="/posts/<slug>">`, a description, tag pills (`/tag:portfolio`) and `<video><source src="https://loadmo.re/media/pages/posts/<slug>/<hash>-<ts>/<name>.mp4">`. Detail pages give the original URL, "Added <Month D, YYYY>" and the tags. There's no RSS, sitemap or JSON.
- **Bot protection:** none. Apache returned 200 for both UAs. robots.txt sets `Crawl-delay: 10`, so throttle.
- **Entry fields:** site name, one-line description, tags (3D, AI & Generative, Brutalist, Glitches, Portfolio…), original URL, added date. Video is a **mobile-viewport screen recording**: H.264 MP4, e.g. 620×1044, about 650 KB, hotlinkable from their origin with no CDN.
  - **Example:** sabrinazeltner.com, described as a textured, layered portfolio that feels like an interactive poster. Tags Portfolio and Glitches, added January 12, 2026, `https://loadmo.re/media/pages/posts/sabrina-zeltner/1876c6860a-1768237897/sabrinazeltner-hp.mp4`, links to https://sabrinazeltner.com/.
- **Volume & cadence:** **stale.** The newest posts are all "Added January 12, 2026", nothing since, so about 10 months idle. Before that it ran in bursts (Dec 2025, May 2025, …), going back to Aug 2020. Total is about 386.
- **ToS risk:** low. There's no terms page and it's a one-person archive by Kim Boutin. Be polite: crawl-delay, and the videos are on the site's own server.
- **Overlap:** low to moderate. It's mobile-web experimental and unconventional work, a niche not covered elsewhere. Taste is high.
- **Verdict: OK as a one-time backfill, Skip as a feed.** It's great, distinctive curation, but it's dead-ish as a stream. Import the ~386 posts once and re-check monthly.

---

## Ranking (for a designer wanting web and visual inspiration in a feed)

1. **Recent (ex-Godly).** It's the best taste, updated daily, with structured data, original URLs and hotlinkable MP4s. It needs a seroval-blob parser.
2. **Spotted in Prod.** It's unique iOS interaction video with clean public JSON and great tags. It's mobile-only.
3. **Land-book.** Its trivial RSS gives about 25/week of steady volume, but the taste is mid, there's template spam, and there's no original URL (everything else is Cloudflare-challenged).
4. **loadmo.re.** Excellent niche curation, but stale since Jan 2026. One-time import only.
5. **Layers.** The API is easy but needs a Referer trick. The content is a noisy Dribbble-style community feed, usable only via `view=top`.
6. **Unbound by default.** About 100 items with nice tags, but bursty and tiny. One-time import at most.
7. **a-fresh.** Stale for 8+ months, generic SaaS landing pages, partly paywalled.
8. **Mobbin.** Valuable content, but paywalled, the ToS forbids scraping, and it isn't a feed. Use the official MCP or API only if paying.
