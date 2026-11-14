# Discovery-feed source feasibility, batch A (probed 2026-11-04)

Method: curl with a desktop Chrome 142 UA and with `curl/8.7.1`, from a residential Mac IP (a Convex action runs from a datacenter IP, so treat "works" as "works from home; likely but unverified from Convex"). Browser pane was used only to look behind challenges (maxibestof, Refero XHRs).

---

## 1. Awwwards — https://www.awwwards.com/

- **Access method (best route):** official-ish **RSS: `https://www.awwwards.com/feed/`** ("Sites of the day", 30 items, served as `text/html` content-type but it is valid RSS 2.0). Works with plain `curl` UA too. For more volume, the listing pages are **server-rendered with embedded JSON**: every card has `data-collectable-model-value="{...}"` (title, slug, image path, `createdAt` unix, tags[]). Pages: `/websites/sites_of_the_day/`, `/websites/nominees/`. Original site URL needs one extra GET of `/sites/<slug>` (`<a href="https://grail-app.com/" target="_blank">`, first non-awwwards `_blank` link). No `__NEXT_DATA__`; `/sitemap.xml` is a meta-refresh redirect stub.
- **Bot protection:** none. nginx, 200 for Chrome UA and curl UA. Pages mention "captcha" only in vote/login widgets.
- **robots.txt:** `Disallow: /feed` (so the RSS is technically robots-disallowed), `/websites/?` (query strings), `/gallery/`, `/tag/`, `/inspiration/search`. `/websites/sites_of_the_day/`, `/websites/nominees/`, `/sites/*` are allowed. No AI-UA blocks.
- **Entry fields (+example):** title, Awwwards detail URL, description, date, image; JSON adds tags (category + tech + style). Images on `assets.awwwards.com` CDN; hotlink OK with foreign Referer. Sizes: `thumb_440_330`, `thumb_880_660`, and full original (`/awards/submissions/...png`, 1600x1200, ~1.6 MB).
  - Example: **Grail** — img `https://www.awwwards.com/awards/submissions/2026/09/6a9e800a81046329756959.png` (1600x1200), date 2026-11-04, original `https://grail-app.com/`, tags `Games & Entertainment, Mobile & Apps, Scrolling, WebGL, Storytelling, 3D, Matter.js, Blender`, desc "Branding and a scroll-driven 3D web experience…".
- **Volume & cadence:** SOTD exactly 1/day (feed = last 30 days). Nominees about 20/day (31 cards covered roughly 1.5 days).
- **ToS risk:** low-moderate. /terms/ does not mention scraping; it says unauthorized reproduction of content is prohibited, and commercial use needs permission. Private, single-user, hotlinked plus link-out is low risk. Republishing would not be.
- **Overlap:** high with Godly, Land-book, SiteInspire, etc. Awwwards is the upstream for a lot of it.
- **Verdict: Great.** Clean RSS + JSON, no protection, big images, original URL one hop away, and the best signal for experimental and WebGL web. Use SOTD for quality, nominees if you want volume.

## 2. Dribbble — https://dribbble.com/

- **Access method:** effectively **not possible with plain fetch**. Every listing (`/`, `/shots/popular`, `/shots/recent`, `/shots/popular/web-design`, `/search/*`, `/tags/*`) and every shot page returns **HTTP 202 with an empty body and `x-amzn-waf-action: challenge`** (AWS WAF JS challenge) for both UAs. A Googlebot UA gets 403. Legacy RSS is dead: `/shots/popular.rss` is challenged, and `/<user>/shots.rss` returns 404 even for real users. API v2 (`api.dribbble.com/v2`) returns 401 and is OAuth-only and own-shots-only, with no popular endpoint.
  - What leaks through: **profile pages** (`/ramotion` → 200, about 18 shots with `cdn.dribbble.com/userupload/...` images and `/shots/<id>-slug` links), so following specific designers is possible. The **sitemap** (`/sitemap.xml` → 191 `images*.xml` files, `sitemap/images.xml` alone is 32 MB / 50k shots) gives shot URL + full image + title + caption, but it is an unranked archive, not a curated feed.
  - A real headless browser would likely solve the AWS WAF JS challenge. That counts as circumventing bot protection, and the ToS forbids it (below).
- **Bot protection:** AWS WAF challenge (CloudFront + ELB) on everything except profiles, sitemaps and 404s.
- **robots.txt:** allows `/shots/popular` and so on. Disallows `/shots/day|week|month|year/*`, `/*/tags/*`, `/colors`, `/search/*` (PetalBot only). No AI-UA blocks.
- **Entry fields (+example):** from the sitemap: `https://dribbble.com/shots/48264-Girl-On-Bench`, img `https://cdn.dribbble.com/userupload/18525643/file/original-fbbaa…jpg` (CDN hotlink OK, supports `?resize=1600x1200`), title "Girl On Bench", caption "…illustration photo". No date or tags, and no "original site" because shots are the work itself.
- **Volume:** huge (shot IDs around 27.8M), but nothing gets you "popular today".
- **ToS risk:** **high.** Terms prohibit copying "by any automated or non-automated 'scraping'", forbid bots beyond human request rates, and forbid circumventing access controls or accessing User Content by unauthorized means.
- **Overlap:** low. The content is unique (UI concepts, illustration, icons, branding), but heavily "Dribbble-ized" (fake app concepts, glossy mockups).
- **Verdict: Skip.** Hard-blocked, ToS-hostile, and the unique content is low signal for real web inspiration. At most, hand-pick a few designer profiles and fetch them manually.

## 3. MaxiBestOf — https://maxibestof.one/

- **Access method:** **needs a real browser.** Every HTML/API path (`/`, `/websites`, `/sitemap_index.xml`, `/feed`, `/rss.xml`, `/api/*`, `/_payload.json`, `api.`/`www.` subdomains) returns **403 `cf-mitigated: challenge` "Just a moment…"** for Chrome, curl and Googlebot UAs. Only `robots.txt` passed. Inside a real browser it is a Nuxt app, and each page has a rich `__NUXT_DATA__` payload (devalue format) with full website records. Pagination is `/websites?page=N` (about 719 pages × 32, roughly 23k sites). There is no RSS. They sell a Pro-only MCP server (`/mcp`), which is the "official" programmatic route. Cloudflare Browser Rendering identifies itself as a bot, so it may also be challenged (untested).
- **Bot protection:** Cloudflare managed challenge site-wide (Nuxt `botDetection: true` is also set). **Image CDN is NOT challenged:** `assets.maxibestof.one/cdn-cgi/image/width=1200,.../<hash>.jpg` returns 200 to curl (1200x750).
- **robots.txt:** allows `/`. Disallows `/go/*` (outbound redirect), `/api/`, `/r/`. No AI-UA blocks.
- **Entry fields (+example):** very rich. From `website-detail` NUXT data:
  - **Flowlife** (id 93553): `url: https://www.flowlife.com`, description, `published_at: 2026-11-04 19:58:00`, `image: /api/websites/93553/preview` (webp, also `?device=mobile`), fonts `[IBM Plex Sans, Inter]`, tags `[Shop, Health, Sports, E-commerce]`, technologies `[React]`, `website_colors` (hex + usage %). `image_full_desktop` is null (full-page shots look Pro-gated). Sections (hero/footer/pricing crops) and typefaces are separate catalogs.
- **Volume & cadence:** about **6 sites per weekday** (counted 6/day on every weekday from 10-13 to 11-04, none on weekends; the site advertises updates every weekday).
- **ToS risk:** moderate. `/legals` is boilerplate, granting only a temporary single-copy licence: no copying, no public display, no "mirror" on other servers. A Pro tier and an MCP paywall signal they monetize the data.
- **Overlap:** high with Land-book, Lapa, SiteInspire for the websites part. The **section crops and font metadata are the unique value.**
- **Verdict: Skip (for automated ingest).** Good curation and the best metadata of the batch, but every route needs a browser past a CF challenge. Revisit only if the Pro MCP is worth paying for.

## 4. Behance — https://www.behance.net/

- **Access method:** **official RSS: `https://www.behance.net/feeds/projects`** (`application/rss+xml`, "Featured Projects", 36 items). It requires a browser-like UA: `curl/8.7.1` gets **400**, Chrome UA gets 200. Query params like `?field=ui%2Fux` are ignored (same feed). Everything else (`/`, `/galleries/*`, `/search/*`, `/gallery/<id>`) returns **403 from Varnish with a JS cookie challenge** (`js_challenge_value`). `/feeds/user?username=` returns 404. The public API was shut down years ago. `/sitemap` index exists (popular_search, jobs, live, localized search), and none of it is a project feed.
- **Bot protection:** Varnish/Adobe JS-cookie challenge on HTML; the feed and CDN are open.
- **robots.txt:** blocks AI UAs (`anthropic-ai`, `ClaudeBot`, `GPTBot`, `CCbot`, etc.) entirely. For `*`, blocks `/v2/`, `/v3/` and many `/search?…` filters. Use a normal browser UA, which we would anyway.
- **Entry fields (+example):** title, Behance project URL, cover image in the description HTML, long description, pubDate. No tags or creative fields in the feed. Image CDN `mir-s3-cdn-cf.behance.net/projects/{404|808|max_808}/...` hotlinkable, max_808 = 808x632 (`1400` size 302s). No external site link because the project is the work.
  - Example: **TONANA** — `https://www.behance.net/gallery/257879639/TONANA`, img `https://mir-s3-cdn-cf.behance.net/projects/max_808/a90af4257879639.Y3JvcCwxMTUzLDkwMiw4OTAsMTA2MQ.jpg`, 2026-11-05 00:30 UTC, a Mesoamerican-inspired bar identity.
- **Volume & cadence:** 36 items over 10-29 → 11-05, about **5/day**, published in 4-hour slots.
- **ToS risk:** low if limited to the RSS. Adobe General Terms forbid access "by any means other than the interface we provide or authorize" and forbid data mining, but RSS is a provided interface. Do not scrape gallery pages.
- **Overlap:** very low with web galleries. Mostly branding, identity, packaging, 3D, illustration and photography, plus a little UI.
- **Verdict: OK (lean Great for variety).** Trivial, legit feed with editorially featured work, but there are only cover images at 808px, and it skews to branding and print rather than web.

## 5. minimal.gallery — https://minimal.gallery/

- **Access method:** WordPress. **RSS `https://minimal.gallery/feed/`** (10 items, works with curl UA) and the **WP REST API** `/wp-json/wp/v2/posts?per_page=N&_embed=1` (open; `x-wp-total: 3032`). Neither the feed nor the REST post contains the original site URL. It is in the **homepage/listing HTML**: `<a href="https://registered-commons.com/?ref=minimal.gallery" class="site-button" title="Visit website">` next to each card, and on the detail page. So: RSS/REST for new items + 1 HTML GET (or parse the homepage) for the outbound link.
- **Bot protection:** none (LiteSpeed). 200 for both UAs.
- **robots.txt:** only `/wp-admin/` disallowed.
- **Entry fields (+example):** title, detail link, date, tags (`_embedded.wp:term`: e.g. Agency, Branding), featured image full **1920x~1066** plus WP sizes (`-1440x800`, `-900x500`), a `-mobile.jpg` variant, and outbound URL (from HTML). Images are hotlinkable from `minimal.gallery/wp-content/uploads/` (also served via rocketcdn).
  - Example: **Registered Commons** — 2026-11-04, `https://minimal.gallery/wp-content/uploads/2026/09/registered-commons.com_.jpg` (1920x1066), original `https://registered-commons.com/`, tags Agency, Branding.
- **Volume & cadence:** **1/day** (RSS shows one item per day, 10-26 → 11-04). About 3k total.
- **ToS risk:** **explicit.** `/legal/` prohibits "scraping, downloading images in bulk, or republishing the gallery". Personal viewing and bookmarking are allowed. Reading the RSS and hotlinking 1 image/day is the defensible route. Don't backfill 3k images into R2.
- **Overlap:** high (minimal / Swiss / agency sites also on Land-book, SiteInspire, Godly).
- **Verdict: OK.** Tasteful, consistent and trivially fetchable, but only 1/day and with a restrictive clause. Good low-noise feed if you like the aesthetic.

## 6. Dark Mode Design — https://www.darkmodedesign.com/

- **Access method:** Webflow. **RSS `https://www.darkmodedesign.com/websites/rss.xml`** (100 items, `application/rss+xml`, works with curl UA). `/rss.xml` and `/feed` return 404. The homepage is also server-rendered (18 cards per page, `?60a99e98_page=N`). The sitemap lists 404 `/websites/*` URLs with lastmod.
- **Bot protection:** Cloudflare in front, but no challenge. 200 for both UAs.
- **robots.txt:** empty apart from the Sitemap line.
- **Entry fields (+example):** best-shaped feed of the batch. `<title>`, detail link, **`<description>` = original site URL**, pubDate, `media:content` image (Webflow CDN `cdn.prod.website-files.com`, webp **1440x1080**, hotlinkable). No tags or colors (the whole site is "dark" by definition).
  - Example: **Lime Duo** — `https://www.darkmodedesign.com/websites/lime-duo`, original `https://limeduo.com`, img `https://cdn.prod.website-files.com/5ea7fd4e3d52ef73804bc877/6ae3bde2c2f94a931ed51122_test.webp`, 2026-10-29.
- **Volume & cadence:** batches roughly **every 2 weeks, 5-11 sites each** (10-29: 5, 10-15: 11, 10-01: 6, 09-16: 6…), about 15-20/month.
- **ToS risk:** low. No terms page was found (`/terms` returns 404), only the RSS is official, and it is a small solo-curated site.
- **Overlap:** moderate. It is a niche filter (dark UIs), and many entries are indie dev/designer portfolios that the big galleries don't carry.
- **Verdict: OK.** Zero-effort RSS with original URL + decent image. Low volume, mixed quality (some GitHub-pages demos), single aesthetic.

## 7. dark.design — https://www.dark.design/

- **Access method:** Next.js (App Router) on Vercel, Supabase backend. **The homepage RSC payload (`self.__next_f.push`) contains the entire catalog as a `sites` array (247 records)** in one 845 KB GET. There is no RSS, and `/sitemap.xml` (→ `dark.design`) lists only 3 URLs. The Supabase project (`sidhvpjhuucqcehkevrl.supabase.co`) is visible, and its public storage bucket serves images. I did not query the Supabase REST API with the embedded anon key, and I don't recommend relying on that.
- **Bot protection:** none (Vercel). 200 for both UAs.
- **robots.txt:** `Allow: /`.
- **Entry fields (+example):** `{id, title, url (original), slug, description, screenshot_url, categories.name, created_at, click_count}`. Screenshots are webp **1440x900**, hotlinkable from Supabase public storage.
  - Example: **Basement** — `https://basement.studio/`, img `https://sidhvpjhuucqcehkevrl.supabase.co/storage/v1/object/public/screenshots/auto-1786786805983.webp`, category Agency, 2026-08-15.
- **Volume & cadence:** **effectively dormant.** created_at: 211 in Mar 2026 (initial import), 1 Apr, 25 May, 6 Jun, 4 Aug, **0 in Sep-Nov**.
- **ToS risk:** low (no terms page). But auto-generated screenshots (`auto-*.webp`) and a sponsor slot suggest a side project.
- **Overlap:** very high with darkmodedesign.com and the big galleries (basement.studio, etc.).
- **Verdict: Skip.** Trivial to fetch but nothing new arrives. At most, do a one-time import of the 247 if you want a dark-UI seed set.

## 8. Refero — https://refero.design/

- **Access method:** React SPA on S3 (the 4 KB shell, plus `/sitemap.xml` and `/rss`, return the same SPA HTML). The XHR backend is **`https://api.refero.design/v1/sites/available?page=N`**, an **unauthenticated JSON API** that answers plain curl (200, about 290 KB/page, 24 per page; `pagination.count = 439`, 19 pages). This is the **free "available" subset**. The full library (many thousands of web/iOS screens, flows, search) needs a paid plan or their MCP (`api.refero.design/mcp`, Bearer token, 8k requests/month cap).
- **Bot protection:** none on the API (Amazon S3 / API returns 200 for both UAs).
- **robots.txt:** `*` allowed, GPTBot blocked.
- **Entry fields (+example):** `{id, domain, name, description, favicon_url, background_url, screenshots[{thumbnail_url, url[] (full-page split into ~17 tiles), width 2732, height 8540, created_at, page_url, colors[[r,g,b]×5]}], featured_screenshots[]}`. Images are on `images.refero.design` (hotlinkable; thumbnails 800x500).
  - Example: **Navia** — `thenavia.com`, page_url `https://www.thenavia.com/`, thumb `https://images.refero.design/screenshots/thenavia.com/desktop/db35fa79-8b26-4b31-930b-128c87f78020_thumb.jpg`, 5-color palette, created 2026-10-12.
- **Volume & cadence:** free set screenshots: 45 in Sep, 30 in Oct 2026, so a few/week visible for free. The paid library grows faster.
- **ToS risk:** **high-ish.** Terms prohibit "scrape or bulk extract Refero Content beyond documented or reasonable use", forbid copying outside documented download features, and forbid republishing as a library. Personal design research is explicitly allowed, but polling an undocumented API is not "documented use".
- **Overlap:** different purpose. It is a **UI pattern reference library** of mainstream product sites (Calendly, Dropbox, Allbirds, Claude, Monday, Zara Home) with full-page captures, flows and iOS screens. Not "wow" inspiration, and little overlap with the Awwwards crowd.
- **Verdict: Skip (as a feed).** Technically the easiest structured data here, but it is a paid reference tool, not a discovery stream, and the content is corporate SaaS. Use it interactively or via the paid MCP when researching a specific pattern.

---

## Ranking (for a re-collect discovery feed)

1. **Awwwards**: Great. RSS + embedded JSON, no protection, 1600px images, tags, original URL one hop away; 1 SOTD/day, about 20 nominees/day. Mind that robots.txt disallows `/feed`.
2. **Behance (Featured RSS)**: OK+. Official feed, about 5/day, unique non-web visual work (branding, 3D, illustration). Needs a browser UA; images 808px.
3. **Dark Mode Design**: OK. Best-shaped RSS (original URL + 1440px image), about 15-20/month in batches; niche aesthetic.
4. **minimal.gallery**: OK. RSS/WP-REST, 1/day, 1920px images, outbound link via HTML; ToS explicitly anti-scraping, so stay with the RSS.
5. **MaxiBestOf**: good content and great metadata (fonts, colors, sections), about 6/weekday, but CF challenge everywhere. Skip unless a browser-based route proves reliable or Pro MCP is acceptable.
6. **Refero**: open JSON API, but a paywalled reference library of corporate UI; ToS forbids bulk extraction. Skip for the feed.
7. **dark.design**: trivially fetchable but dormant since Aug 2026, 247 total. Skip (optional one-time seed).
8. **Dribbble**: AWS WAF on all listings, RSS dead, API useless, ToS bans scraping. Skip.

Practical shortlist for plain Convex `fetch`: **Awwwards RSS (+ nominees JSON), Behance featured RSS, darkmodedesign RSS, minimal.gallery RSS.** All four hotlink fine. Only Awwwards and minimal.gallery need a second request per item for the original URL.
