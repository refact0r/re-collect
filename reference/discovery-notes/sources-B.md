# Discovery-feed source feasibility — batch B (probed 2026-11-04)

Method: `curl` with desktop Chrome UA and with the plain curl UA, plus the desktop app's built-in browser (real Chromium) for sites behind Cloudflare. "Server fetch" below means a plain `fetch` from a Convex action.

---

## 1. Stacksorted — https://stacksorted.com/

- **Access method:** Svelte SPA on Vercel. The whole dataset is hardcoded in `/build/bundle.js` (65 KB) as `{buttons:[{name,url,image,gif,code}],…}` across 16 element categories (buttons, cards, custom-cursor, grids, hamburger-menu, headers, hover-effects, icons, image-effects, interactive-elements, links, loading-animation, progress-bar, scroll-effects, search, text-effects). There's no RSS, sitemap, or robots (all paths return the SPA shell). Source is on GitHub at `juxtopposed/stacksorted`, with no license.
- **Bot protection:** None. Both UAs got 200, images included.
- **Entry fields:** name, original site URL, static `.webp` (~733×388), optional animated `…g.webp` (~185 KB), optional CodePen link, and the element category. No dates. 180 entries, 124 with animated clips.
  - Example: `{category: "icons", name: "Resend", url: "https://resend.com/", image: "https://stacksorted.com/images/icons-2.webp"}`
- **Volume & cadence:** Dead. The last commit was 2025-03-31 (before that, Aug 2024). One-time import of 180 items.
- **ToS risk:** No terms page and no license. Low risk for a personal one-time import.
- **Overlap:** The featured sites overlap Awwwards/Godly (Cuberto, Obys, Resend, Stripe Press). The element-level framing ("show me cursor effects") is unique.
- **Verdict: Skip as a feed, OK as a one-time import.** The element-sorted clips are nice, but there are only 180 and nothing new since early 2025.

## 2. landing.love — https://www.landing.love/

- **Access method:** Next.js App Router (RSC). Real browsers get server-rendered HTML with cards. Each detail page has JSON-LD (`VideoObject` + `Article` with `datePublished`) and a "Visit Site" link (`https://www.quangdinh.im/?ref=landing.love`). Sitemap index → `sitemap-posts.xml` (2,256 `/sites/` URLs with lastmod) and `sitemap-videos.xml`. No RSS.
- **Bot protection:** Hard. Cloudflare WAF **block** (403 "Attention Required! | Cloudflare … You are unable to access") for curl with both UAs, with full Sec-Fetch/sec-ch-ua headers, and for WebFetch. This is a block, not a JS challenge, so it's likely TLS-fingerprint or bot-score based. The real browser pane loads it fine. A plain Convex `fetch` will not work. You'd need the Puppeteer worker, and Cloudflare Browser Rendering may itself be scored as a bot (untested). `robots.txt` explicitly _allows_ everyone, AI bots included, so the WAF contradicts it.
- **Entry fields:** title, short description, original URL (detail page only), categories (~170 taxonomies such as 3D Website, Portfolio, Minimal, SaaS), authors/studios, publish date, poster `cdn.landing.love/images/<slug>-thumb.webp` (**1440×1024**, curl-fetchable, 200), and video `cdn.landing.love/videos/<slug>-thumb.mp4` / `<slug>.mp4` (403 to curl, browser only).
  - Example: Quang Dinh — `/sites/quangdinh-2/` → https://www.quangdinh.im/ , datePublished 2026-10-31, poster https://cdn.landing.love/images/quangdinh-2-thumb.webp
- **Volume & cadence:** 2,256 sites total. Recent months: Jun 58, Jul 34, Sep 15, Oct 100. Roughly 1–3/day, bursty.
- **ToS risk:** No terms page (privacy only). Robots allows all. The practical barrier is the WAF, not legal.
- **Overlap:** High with Lapa/Godly/Awwwards. The same sites appear on Lapa (e.g. Leo Parpeix is on both front pages).
- **Verdict: OK.** Content is great (video-first, well curated, portfolio/3D/agency heavy). Access needs a headless browser and may break.

## 3. Made in Webflow (popular) — https://webflow.com/made-in-webflow/popular

- **Access method:** Undocumented but robots-allowed JSON API, found via the page's XHR: `GET https://webflow.com/api/v1/marketplace/made-in-webflow/feed/{popular|recent}?limit=18&offset=N&cloneable=false&excludeCloneable=true&tag=`. Returns 200 to both UAs. `limit` is capped at 18. The SSR page also embeds the same data in `__NEXT_DATA__.props.pageProps.fallbackData`. `robots.txt` has `Allow: /api/v1/marketplace/made-in-webflow/`.
- **Bot protection:** Light for now: 200 everywhere. PerimeterX (`px-cloud.net` collector) and Datadog RUM run on the page, so it could tighten.
- **Entry fields:** title, description, slug, tags (user-entered, e.g. `gsap, animations`), numViews/numLikes/timesCloned, createdOn/popularOn, and `thumbImg` (screenshots.webflow.com or cdn.prod.website-files.com, **540×360**, small, hotlinkable). **No live site URL in the API.** It's only on the detail page HTML (`/made-in-webflow/website/<slug>` contains e.g. `href="https://streamtime.net"` plus a `*.webflow.io` fallback).
  - Example: Streamtime — tags [gsap, animations], 12,993 views, thumb `https://screenshots.webflow.com/sites/6807989b…/20250622162022_….png`, live URL https://streamtime.net
- **Volume & cadence:** "Popular" barely moves: most of the top-18 `popularOn` dates are from 2025. "Recent" is an unmoderated firehose of about 25/day (18 items in about 17 h: "Hot Shot Specialty Welding", "Blog Généalogie Québec", cloneable demos, etc.).
- **ToS risk:** **High-ish.** Webflow's Acceptable Use Policy forbids it outright: "Do not use any automated or manual process, including … page-scraping." This sits against the robots allowance.
- **Overlap:** Webflow-only. Partly unique, but mostly mediocre SMB sites. Cloneables/GSAP demos are the interesting slice.
- **Verdict: Skip.** "Popular" is stale, "recent" is low-signal noise, thumbs are tiny, and the AUP forbids scraping.

## 4. Landingfolio — https://www.landingfolio.com/

- **Access method:** **Open JSON backend** (Nuxt front end, Express on Render): `GET https://landingfolio-2026.onrender.com/inspiration?page=N` returns 80 items/page with no auth (200 to both UAs). Also available: `/inspiration/post/<slug>` (full record), `/category` (taxonomy with counts), `/inspiration/page-types`. The sitemap (`/sitemap.xml`, 500 URLs, no lastmod) is less useful. Robots only disallows account pages.
- **Bot protection:** None observed (Vercel front end, Render API, imgix images, all 200).
- **Entry fields:** title, **original `url`**, `postDate`, `categories` (e.g. business, crm, product), **`colors.hex` (6-color palette) + LAB values**, and multiple full-page screenshots per site keyed by page type (`landing-page`, `pricing`, `login`, `signup`, `404` …) with desktop and mobile variants. Images are on imgix (`landingfoliocom.imgix.net/<path>`), hotlinkable, and native size is tall (1131×8192). Use imgix params to crop, e.g. `?w=1200&h=900&fit=crop&crop=top&auto=format` (~99 KB).
  - Example: `{title: "ProIntro", url: "https://www.prointro.com/", postDate: "2026-11-04", categories: ["business","mobile-app","real-estate","crm","product"], colors.hex: ["#35c756","#664a25",…], screenshots: [landing-page, pricing, login, signup]}`
- **Volume & cadence:** Sep 14, Oct 17, Nov 2 (so far). About 15/month, around 3–4/week. The feed order mixes in older items (2023–2024), so sort by `postDate`. There's also a "components" library (4,652 categorized section crops).
- **ToS risk:** Medium on paper. Their terms say "You agree to not copy, duplicate or otherwise reproduce any part of our website…". Some content is sold (Pro/templates). Fine in practice for private personal use.
- **Overlap:** SaaS landing pages overlap saaslandingpage/SaaSFrame/Lapa. The palette data and the per-page-type shots (pricing/login/404) are unique and useful.
- **Verdict: Great (access), OK (taste).** It's the easiest source of the eight: clean JSON with palettes and original URLs. Content is solid SaaS rather than cutting-edge.

## 5. SaaS Landing Page — https://saaslandingpage.com/

- **Access method:** WordPress 6.3. **RSS at `/feed/`** (10 items, featured image inline) and **WP REST `/wp-json/wp/v2/posts`** (x-wp-total 574, capped at 14 per page, `_embed` gives terms). The sitemap index is at `/sitemap_index.xml` (Yoast). The original URL is _not_ in RSS/REST. It's in the listing/detail HTML as `<a id="ext-link-<postId>" href="https://www.twelvelabs.io/">` (plain HTML, easy regex).
- **Bot protection:** Cloudflare, but no challenge (200 to both UAs, `cf-cache-status: HIT`). Robots is Cloudflare's managed AI-crawler block (ClaudeBot, GPTBot, CCBot … `Disallow: /`), plus `Content-Signal: search=yes, ai-train=no, use=reference`. Generic `*` is allowed.
- **Entry fields:** title, date, categories/tags (Landing page, AI), fonts used (`/font/inter/`, `/font/geist-sans/` … on the detail page), and a full-page PNG at `wp-content/uploads/…` (1440×11401 plus resized variants, hotlinkable, no cropped thumbnail, so you'd crop yourself or screenshot).
  - Example: TwelveLabs — https://saaslandingpage.com/twelvelabs/ → https://www.twelvelabs.io/ , 2026-11-04, [Landing page, AI], fonts Geist Sans/Mono, image `…/2026/11/twelvelabs.png`
- **Volume & cadence:** 10 RSS items span Oct 14 – Nov 4 (14 posts since Oct 1). About 3–4/week, 574 total.
- **ToS risk:** Low to medium. There are no terms (privacy policy only), but robots/content-signals mark the content "reference only, no AI training". A personal feed is fine. Don't feed it to model training.
- **Overlap:** SaaS-only. Heavy overlap with Landingfolio/SaaSFrame/Lapa's SaaS category, and with their own sister site saasinterface.com.
- **Verdict: OK.** Trivial access (RSS plus one HTML fetch for the URL). The content is a generic SaaS-template look, and the images are huge tall PNGs.

## 6. Lapa Ninja — https://www.lapa.ninja/

- **Access method:** Hugo static site. **RSS at `/index.xml`** (100 items) is the only path a server can fetch: it returns 200 to curl even though everything else is blocked. RSS items have title, link, pubDate, short description, and a poster `<img>`, but **no original site URL**. That's only on `/post/<slug>/` ("Visit" → `https://www.leoparpeix.com/?ref=lapaninja`), which is blocked server-side. There's a sitemap index (13 sub-sitemaps), browser only.
- **Bot protection:** **Hard.** Same Cloudflare WAF block as landing.love (403 "Attention Required!") for homepage, posts, sitemap, and robots, under both UAs and WebFetch. **`cdn.lapa.ninja` images are also 403 to curl**, even with a Referer, so you can't download images into R2 server-side (they load in a real browser). Robots (seen via browser) allows all, `Disallow: /api/`.
- **Entry fields:** title, date, description, poster (`cdn.lapa.ninja/assets/videos-poster/<x>-poster.jpg` or `assets/images/1x/<x>.jpg`). Category, colour, and font tags are on detail pages (e.g. Portfolio, Minimal, Typography, "white").
  - Example (RSS): Byotōne — https://www.lapa.ninja/post/byot-ne/ , 2026-11-03, poster `https://cdn.lapa.ninja/assets/videos-poster/byotone-poster.jpg`
- **Volume & cadence:** 100 items span Jul 14 – Nov 3, about 0.9/day (about 6/week). 7,300+ total.
- **ToS risk:** No terms link found. The risk is technical (the WAF), not legal.
- **Overlap:** Very high with landing.love/Land-book/Godly (same portfolios). Ad-heavy site.
- **Verdict: OK at best, leaning Skip.** RSS gives titles and dates, but no original URL and no fetchable images without a headless browser. You'd end up screenshotting the original yourself after resolving it via the browser.

## 7. One Page Love — https://onepagelove.com/

- **Access method:** WordPress. **RSS at `/feed`** (10 items) works with both UAs, with rich `<category>` tags and a 1200×1200 top-cropped screenshot in `content:encoded`. The original URL comes from one plain-HTML fetch of the post (`<a … title="Visit Pete Sena Website" href="https://petesena.com?ref=onepagelove">`). `wp-json` is 403 (disabled). The sitemap index is at `/sitemapindex.xml` (`post_part1/2.xml`: about 9.6k URLs).
- **Bot protection:** Cloudflare, no challenge. Images on `assets.onepagelove.com` (Cloudflare Image Resizing) return 200 to the plain curl UA and are resizable via `/cdn-cgi/image/width=…,height=…,fit=cover,gravity=top/…`.
- **Robots:** `Disallow: /feed/` and `/*/feed` for `*`, despite advertising the feed in `<link rel=alternate>` (`/feed` without a slash isn't technically matched). It also blocks Bytespider/Amazonbot/meta.
- **Entry fields:** title ("Website Inspiration: X"), date, author, a hand-written review paragraph describing the design ("cinematic dark-to-light transitions, floating media fragments…"), 5–12 tags (style tags such as Long Scrolling, Interactive, WebGL, Animations, plus profession tags), screenshot (1200×1200 crop; the full desktop capture is also in uploads), and the original URL (detail page).
  - Example: Pete Sena — https://onepagelove.com/pete-sena → https://petesena.com , 2026-11-04, tags [Long Scrolling, Digital Agency, Creative Director, AI…], img `https://assets.onepagelove.com/cdn-cgi/image/width=1200,height=1200,fit=cover,gravity=top,format=jpg,quality=85/wp-content/uploads/2026/11/opl-screenshot-pete-sena-1793719760461-desktop.jpg`
- **Volume & cadence:** 10 items over Oct 28 – Nov 4, about 1.4/day (about 10/week). Very consistent; running since about 2008.
- **ToS risk:** Low. The legal page notes "Screenshots and descriptions … remain the property of their respective owners and are shown for the purpose of review and reference". There's no anti-scraping clause. The only red flag is the robots `/feed/` disallow.
- **Overlap:** Moderate with landing.love/Lapa (portfolios). The written design notes and style tags are distinctive and feed nicely into `searchText`.
- **Verdict: Great.** Cleanest server-side path (RSS plus one HTML fetch), good images, descriptive text, steady cadence. Quality is a notch below Godly-tier, but consistently decent.

## 8. Seesaw — https://www.seesaw.website/

- **Access method:** Next.js App Router on Vercel, prerendered. **The entire catalog (893 sites) is embedded in the homepage RSC payload** (`self.__next_f.push(…)`, 3.6 MB) as `{"sites":[{id,title,description,slug,link,fonts:[recId],category:[recId],imgId,ogImg,publishedDate,lqip}]}`. The backend is Airtable (`rec…` IDs). Category and font records (`{"id":"recYAweLXcC5uC2lk","name":"AI",…}`) are in the same payload. Unescape `\"` and regex out the `sites` array. Also a sitemap (`/sitemap-0.xml`, 1,791 URLs). No RSS (feed/rss.xml/feed.xml all 404).
- **Bot protection:** None (Vercel, 200 to both UAs). Robots allows all.
- **Entry fields:** title, one-line description, **original `link`**, `publishedDate`, categories (AI, etc.), fonts, the site's own `ogImg` (Cloudinary, e.g. 1280×630), and **`imgId` = a Cloudinary screen recording**: `https://res.cloudinary.com/seesawsite/video/upload/<imgId>.mp4` (raw is about 34 MB 4K, so always add a transform like `w_640,q_auto` → about 1.3 MB). Poster frame: `…/video/upload/<imgId>.jpg` (**3840×2158**). All hotlinkable.
  - Example: `{title: "heyclicky", description: "an ai buddy that lives on your mac", link: "https://www.heyclicky.com/", publishedDate: "2026-07-18", category: ["AI", …], poster: "https://res.cloudinary.com/seesawsite/video/upload/heyclicky_sml_qfog0t.jpg"}`
- **Volume & cadence:** Very steady at 18–24/month (about 5/week) for the past 13+ months. 893 sites total.
- **ToS risk:** Low. No terms page. One caveat: don't hotlink the raw MP4s (you'd burn their Cloudinary bandwidth). Store the poster frame or a transformed clip in R2.
- **Overlap:** Low to moderate. Taste skews to startup and indie product sites (Linear, Amie, Loops, Antimetal, Vercel) with polish and motion, which overlaps a bit with Godly but not much with the portfolio-heavy galleries.
- **Verdict: Great.** One fetch gets the full catalog with original URLs, dates, categories, and high-res video posters. No protection, and high curation quality.

---

## Ranking (for a re-collect discovery feed)

1. **Seesaw.** Best overall: one unprotected fetch, original links, 4K posters/video, high taste, steady ~5/week.
2. **One Page Love.** RSS plus one HTML fetch, good crops, written design notes and style tags, ~10/week. (Robots disallows `/feed/`, minor.)
3. **Landingfolio.** Open JSON with palettes, original URLs, and per-page-type shots. SaaS-flavoured, ~3–4/week.
4. **landing.love.** Excellent video-first curation (~1–3/day), but Cloudflare blocks every non-browser request. Needs headless, and that's fragile.
5. **SaaS Landing Page.** Trivial access (RSS/REST), but generic SaaS look and giant tall PNGs.
6. **Lapa Ninja.** RSS is reachable, but no original URLs, and its CDN and pages are Cloudflare-blocked. Overlaps landing.love.
7. **Stacksorted.** Dead since Mar 2025. 180 element-sorted clips are worth a one-time import, not a feed.
8. **Made in Webflow.** Stale "popular", noisy "recent", tiny thumbs, and the AUP explicitly bans scraping.

## Cross-cutting notes

- Plain Convex `fetch` works for **Seesaw, OPL, Landingfolio, SaaSLandingPage, Stacksorted, Webflow, and Lapa RSS only**. landing.love and Lapa (pages and CDN) need a real browser fingerprint. Whether Cloudflare Browser Rendering gets through their WAF is untested.
- Every source except Webflow's API and Lapa's RSS exposes the original site URL, so you can always fall back to your own Puppeteer screenshot keyed on the original URL and dedupe across galleries by normalized hostname (strip `?ref=`).
