# Discovery sources, batch B: non-website and mixed visual inspiration (probed 2026-11-05)

Method: for each site I ran `curl -sSL -m 20` twice, once with a desktop Chrome 141 UA and once with `curl/8.7.1`, and checked for walls. I then found where the listing data lives, wrote an extractor (`python3 -I <script>.py`), and checked media with `curl -sIL`: once with no Referer, once with `Referer: https://re-collect.example/`, and once more with a browser UA. Dimensions come from `sips` on the downloaded file. Scripts and raw outputs (`out_*.json`) are in `/private/tmp/claude-501/-Users-yifan-Documents-re-collect/76f95e82-6be6-46d7-ad4b-819e0c73ee06/scratchpad/embedded-B/`.

**45 sites probed.** 24 have working extractors; the rest are walled, dead or out of scope.

Short version: the best non-website sources are **Fonts In Use, typo/graphic posters, The Brand Identity, It's Nice That, BP&O, showreel.design and logosystem**. All of them serve clean structured data, and their media hotlinks with no Referer check. **No usable site in this batch checks Referer.** The only media that refused a request was Codrops' KeyCDN, which wanted a browser UA, and Codrops is walled anyway. Some sites send the wrong content-type (showreel posters, Rive), so check that in the UI.

## Summary table

| site                                              | content type                                                         | data location                                                                                                                                                                                                                                                      | items extracted                              | media hotlinkable? / res                                                                                                            | fresh? / cadence                                                                                                                             | risk                                                                                                                            | verdict                    |
| ------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| **fontsinuse.com**                                | Type in use: print, identity, packaging, editorial                   | `https://fontsinuse.com/main.rss` (RSS 2.0, full HTML with every image). Homepage is SSR cards (staff picks); `/uses` didn't return gallery cards                                                                                                                  | 10 (`fontsinuse.py`)                         | Yes, 200/200. `upto-700xauto` URLs 302 to an on-demand resizer; `@2x` gives 1399×993 jpeg. Typeface specimen PNGs too               | Newest 2026-11-05, about 8–10 a day                                                                                                          | robots `*`: Crawl-delay 10, Disallow /search; GPTBot blocked. Each image is marked "All Rights Reserved"                        | **Great**                  |
| **typographicposters.com** (typo/graphic posters) | Posters, plus animated-poster MP4s                                   | Open JSON `GET /api/tg/posters-recent?page=0&itemsPerPage=N` (endpoint found in `main-*.js`). The homepage also embeds `__TG_STATE__ = JSON.parse(...)`. Image URL is `https://images.typographicposters.com/poster-2x/<path>.jpg`                                 | 10, sorted from 24 (`typographicposters.py`) | Yes, 200/200. `poster-2x` is 1132×1600 jpg. MP4 at `assets.…/animated-poster/…` is 200. `/original/` returns 403                    | Newest 2026-11-05. About 3 a week (14 in Oct). The "recent" list is **not chronological**, so sort by Mongo ObjectId time and scan 2–3 pages | `x-robots-tag: noindex` on the API; robots only blocks /wp/. Undocumented API                                                   | **Great**                  |
| **the-brandidentity.com**                         | Identity/brand projects, interviews, typefaces (image or MP4 heroes) | **Open Craft GraphQL** `POST /api` (query `entries(section:"articles")` with `featuredImage`, `tags`, `postDate`). The same data is in `__NUXT_DATA__` on `/features` (devalue decoder in `common.py`)                                                             | 10 (`brandidentity.py`)                      | Yes, 200/200. Laravel-Cloud bucket: 2000×1333 jpg, MP4 plus a `_video-thumbnails/<id>.jpg` poster, dominant colour and aspect ratio | Newest 2026-11-06 (UTC+4). About 8–10 a week                                                                                                 | robots Allow /. Unauthenticated GraphQL could be locked down. The bucket host is an opaque `fls-<uuid>.laravel.cloud`           | **Great**                  |
| **itsnicethat.com**                               | Graphic design, illustration, editorial, photo                       | `<script id="props" type="application/json">` on the homepage (also on category pages). Walk it for objects with `publicationDate` and `listingImage`                                                                                                              | 12 (`itsnicethat.py`)                        | Yes, 200/200. `?class=w1440` gives 1440×1769. The bare original is capped near 1600w. Full width/height in JSON                     | Newest 2026-11-05. About 15–20 a week                                                                                                        | robots **disallows `/articles.rss` and `/articles.atom`**, so use the HTML props, not the feed                                  | **Great**                  |
| **bpando.org** (BP&O)                             | Branding and packaging reviews                                       | WP REST `/wp-json/wp/v2/posts?_embed`                                                                                                                                                                                                                              | 10 (`wpjson.py`)                             | Yes, 200/200. Uploads at full res (3580×2000). Many posts have inline **MP4 loops** (200 video/mp4)                                 | Newest 2026-11-05. About 3 a week                                                                                                            | The featured image is sometimes a tiny video poster (426×240), so prefer the first inline image or MP4                          | **Great**                  |
| **logosystem.co**                                 | Logos, wordmarks, **animated logos**                                 | Next.js RSC `self.__next_f.push` payload on `/`. It holds `{"logos":[…]}` with all **1,383** logos: `image`, `width`/`height`, `video_url`, `source_link`, `styles`, `tags`, `newRank`, `fresh:"Latest additions"`                                                 | 10 (`logosystem.py`)                         | Yes, 200/200. 1200×1200 jpg. Animated logos are MP4 (`cdn.logosystem.co/animated/*.mp4`, 200)                                       | **No dates.** 60 items carry the "Latest additions" flag, so diff snapshots and order by `newRank`                                           | 1.1 MB payload. robots blocks /api/ (unused here). RSC shape may change                                                         | **Great** (logo niche)     |
| **showreel.design**                               | Motion design showreels                                              | **Open JSON** `GET /api/videos.json` (found in the homepage JS; all 259 reels with `publishDate`, styles, industries)                                                                                                                                              | 10 (`showreel.py`)                           | Mostly. Preview-loop MP4 is 200 video/mp4. **The poster JPG (854×480) is served as `video/mp4`**, so test it in `<img>`             | Newest 2026-11-02. 14 in Oct, 34–40 a month over summer, about 3–8 a week                                                                    | robots: Cloudflare Content-Signal `ai-train=no`; Allow /. The full reel isn't in the JSON                                       | **Great** (motion)         |
| **mindsparklemag.com**                            | Branding, packaging, print, plus some websites                       | `/feed` RSS (one cover jpg per item, plus the outbound studio link). Homepage HTML also has cover MP4s under `/storage/media/<id>/…mp4`                                                                                                                            | 10 (`rssgen.py`)                             | Yes, 200/200. 1400×900 jpg; MP4 200                                                                                                 | Newest 2026-11-05. About 1–2 a day                                                                                                           | Includes `/website/` posts (the other agent's area), so filter by path `/designs/`                                              | OK→Great                   |
| **underconsideration.com/brandnew**               | Logo/identity reviews (before/after)                                 | WP REST works (strip the PHP warnings printed before `[`), but **`content` is empty because of the Memberful paywall** and there's no featured media. Take the `og:image` from each post page (one extra GET per item). `/feed/` returns 500 ("No feed available") | 10 (`wpjson.py … --og`)                      | Yes, 200/200. 2000×1125 before/after PNG                                                                                            | Newest 2026-11-05. About 3–4 posts a day, about 1–2 of them reviews                                                                          | Filter out Job Board / Linked / News / Quirky. robots.txt 404                                                                   | OK (Great for logo nerds)  |
| **abduzeedo.com**                                 | Graphic design and branding blog (Astro front, Drupal CMS)           | `/rss.xml` (one `<enclosure>` hero per item). Open Drupal **JSON:API** at `cms.abduzeedo.com/jsonapi/node/article` (200) if you want more                                                                                                                          | 10 (`rssgen.py`)                             | Yes, 200/200. 1400×1400 originals                                                                                                   | Newest 2026-11-05. About 5–8 a day                                                                                                           | Content-Signal `ai-train=no, use=reference`. High volume, uneven quality                                                        | OK                         |
| **theinspirationgrid.com**                        | Branding, illustration, photo, art                                   | Headless **WP REST at `inspgr.id/wp-json`** (the Gatsby front has empty page-data)                                                                                                                                                                                 | 10 (`wpjson.py`)                             | Yes, 200/200. 1680×1186 feature jpg                                                                                                 | Newest 2026-11-05. About 2 every weekday (about 10 a week)                                                                                   | Gallery images aren't in REST `content` (featured only). `link` is relative, so prefix the domain. No robots.txt                | OK                         |
| **thedieline.com**                                | Packaging                                                            | WP REST (wp.com VIP)                                                                                                                                                                                                                                               | 10 (`wpjson.py`)                             | Yes, 200/200. 1600–2130w                                                                                                            | Newest 2026-11-05. About 5 a day                                                                                                             | News-heavy; some featured images are screenshots                                                                                | OK                         |
| **creativeboom.com**                              | Art, illustration, design                                            | `/feed/` RSS with 4–22 inline webp per item                                                                                                                                                                                                                        | 10 (`rssgen.py`)                             | Yes, 200/200. 1280×1494 webp (`-medium` conversion)                                                                                 | Newest 2026-11-05. About 4 a day                                                                                                             | Mixed with "insight"/news posts. robots only blocks archive bots                                                                | OK                         |
| **trendlist.org**                                 | Graphic design: book covers, posters, print, tagged by "trend"       | SSR homepage cards `<a href=/images/slug><img …-trend-list-YYYYMMDD-1.jpg>`, plus the detail page for designer, trend, colours and "Quoted from" source                                                                                                            | 10 (`trendlist.py`)                          | Yes, 200/200, but **only about 325×500**                                                                                            | Newest 2026-11-06. About 50 a day (bulk)                                                                                                     | Crawl-delay 10. Many items are bulk-lifted from shop listings (San Serriffe)                                                    | OK (low-res)               |
| **60fps.design**                                  | Mobile UI animation shots                                            | Framer SSR HTML: `<video poster=gumlet…><source src=…/main.mp4>`, with nearby `./apps/<app>` and `./shots/<slug>` links. Date comes from the Gumlet asset id (ObjectId)                                                                                            | 10 (32 on the homepage) (`fps60.py`)         | Yes, MP4 200 video/mp4. Poster PNG 800×800                                                                                          | Newest 2026-10-20. Batches of about 5 every 2 weeks                                                                                          | Fragile Framer class markup. Cross-links to Mobbin (`?via=60fps`)                                                               | OK                         |
| **motionographer.com**                            | Motion design features and breakdowns                                | WP REST                                                                                                                                                                                                                                                            | 10 (`wpjson.py`)                             | Yes, 200/200. Featured is a 600px GIF; inline MP4s (200) and `i0.wp.com` jpgs at 960w                                               | Newest 2026-11-04. About 1 a week                                                                                                            | Featured images are small, so pull the inline MP4                                                                               | OK                         |
| **Rive community** (rive.app)                     | Interactive vector animations                                        | The static Next export calls **open JSON** `https://api-cached.rive.app/api/community-posts/featured?page=0&limit=N` (`/api/community-posts` = recent, noisy)                                                                                                      | 10 (`rive.py`)                               | Mostly. MP4 (500–1600px) and PNG thumb are 200 but **`binary/octet-stream`** from S3                                                | Featured newest 2026-10-01. About 2–4 a month                                                                                                | Undocumented API                                                                                                                | OK                         |
| **CodePen Spark** (codepen.io/spark)              | Creative coding picks                                                | `/spark/feed` RSS. Each issue has `<h3><a pen>title</a></h3><p><a><img></a></p>` blocks, about 8 pens per issue                                                                                                                                                    | 10 (`codepenspark.py`)                       | Yes, 200/200. Cloudflare `cdn-cgi/image/width=600` → set `width=1200` for 1200×678 png. Static screenshots only                     | Newest 2026-11-05. About 2 issues a week                                                                                                     | `codepen.io/picks` and pen pages are CF-walled for server fetch (fine for users clicking through). Content-Signal `ai-train=no` | OK                         |
| **three.js Discourse #showcase**                  | WebGL/WebGPU demos, 3D                                               | Discourse JSON `/c/showcase/7.json` (`image_url`, tags, likes, `created_at`)                                                                                                                                                                                       | 10 (`threejs.py`)                            | Yes, 200/200. 1024px jpg/gif                                                                                                        | Newest 2026-11-01. About 15–20 a week                                                                                                        | Dev demos and games; uneven taste                                                                                               | OK                         |
| **LottieFiles featured**                          | Lottie animations                                                    | Public GraphQL `POST https://graphql.lottiefiles.com/2022-08` `featuredPublicAnimations`. The page itself is a Remix turbo-stream blob                                                                                                                             | 10 (`lottie.py`)                             | Yes, 200/200. MP4, GIF 640×640, PNG 640×640, `.lottie`                                                                              | Newest 2026-10-04. About 2–4 a month                                                                                                         | robots blocks `/api/*` on lottiefiles.com (GraphQL is a separate host)                                                          | Skip (generic stock style) |
| **Spline community**                              | 3D scenes                                                            | `/api/llms-md` (markdown list of featured scenes) plus `/file/<uuid>.md` (date, tags). The preview follows a predictable pattern, `community-filepreview.spline.design/<uuid>.jpg`                                                                                 | 7 (regex missed a few rows) (`spline.py`)    | Yes, 200/200. 1304×737 jpg                                                                                                          | Newest 2026-11-03. "Featured" mixes 2024–2026                                                                                                | The md wraps user text in "untrusted content" markers. Quality uneven                                                           | Skip/OK                    |
| **Vimeo Staff Picks**                             | Short film and animation                                             | `/channels/staffpicks/videos/rss` (`media:thumbnail` and `media:player` nested in `media:content`)                                                                                                                                                                 | 10 (`rssgen.py`)                             | Yes, 200/200. 960×540 jpg. Video only via iframe player                                                                             | Newest 2026-11-05. About 1 a day                                                                                                             | Mostly documentary and narrative, not design                                                                                    | Skip                       |
| **astro.build/showcase**                          | Sites built with Astro                                               | SSR HTML cards (title, URL, webp)                                                                                                                                                                                                                                  | 10 (`astro.py`)                              | 200/200, 800×450 webp, but **hashed `/_astro/*.webp` names change on redeploy**, so hotlinks will rot                               | No dates. GitHub "ci: update showcase" commits about weekly                                                                                  | Overlaps the website-gallery agent                                                                                              | Skip                       |
| **identitydesigned.com**                          | Identity case studies                                                | WP REST                                                                                                                                                                                                                                                            | 10 (`wpjson.py`)                             | Yes, 200/200. 2200×1589                                                                                                             | One post on 2026-11-05 **after a 23-month gap** (previous 2024-12-16)                                                                        | Crawl-delay 2                                                                                                                   | Skip (dormant)             |

### Walled, dead or out of scope (probed, no extractor)

| site                                                      | finding                                                                                                                                                                                                                                                | verdict                                    |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| tympanus.net/codrops (retest)                             | Still **CF challenge**: 403 `cf-mitigated: challenge` on HTML, `/feed/` and `/wp-json/` for both UAs. `feeds.feedburner.com/tympanus` is 200, but `lastBuildDate` is frozen at 2026-09-14. KeyCDN media is **403 without a browser UA** (200 with one) | Skip (walled; would need a browser/worker) |
| codepen.io/picks                                          | CF challenge, 403 on page and `/picks/feed/`                                                                                                                                                                                                           | Walled; use the Spark feed                 |
| shadertoy.com                                             | CF 403 on site and `/api/v1/shaders`                                                                                                                                                                                                                   | Walled                                     |
| packagingoftheworld.com                                   | Sucuri CloudProxy JS challenge (307 "You are being redirected…")                                                                                                                                                                                       | Walled                                     |
| typewolf.com                                              | 200 with Chrome UA, connection reset with curl UA. Newest Site of the Day is **2025-12-14** (images 984×590, hotlinkable)                                                                                                                              | Dead                                       |
| logobook.com                                              | Sitemap `lastmod` 2019; homepage is category nav only                                                                                                                                                                                                  | Dead                                       |
| grainedit.com                                             | Newest WP post 2019-01-29                                                                                                                                                                                                                              | Dead                                       |
| typeroom.eu                                               | Newest upload path 2026-03-31                                                                                                                                                                                                                          | Stale (>7 months)                          |
| designspiration.com                                       | SSR grid (`dspncdn.com/a1/media/{236x,472x,692x,originals}`) but no dates or feed. The homepage is a curated pile of old saves. "originals" was 538px on the sample                                                                                    | Skip                                       |
| uimovement.com                                            | Now serves Page Flows ("UI/UX Design Inspiration & User Flows")                                                                                                                                                                                        | Skip (Mobbin-like)                         |
| motionfolios.com                                          | Divhunt site builder. Empty `#dh-website` for normal UAs; prerendered HTML only for a Googlebot UA, which shouldn't be spoofed                                                                                                                         | Skip                                       |
| readymag.com/explore                                      | JS-rendered. `window.ServerData` holds only config; curl UA gets 403                                                                                                                                                                                   | Skip                                       |
| cargo.site                                                | 2 KB SPA shell                                                                                                                                                                                                                                         | Skip                                       |
| nextjs.org/showcase                                       | RSC, but a static hand-picked list of 8–20 big brands (Sonos, Nike, OpenAI)                                                                                                                                                                            | Skip                                       |
| madewithsvelte.com                                        | Dev library directory                                                                                                                                                                                                                                  | Skip                                       |
| animography.net                                           | Shopify animated-font shop, not a gallery                                                                                                                                                                                                              | Skip                                       |
| niice.co                                                  | Pivoted to a "brand portal" SaaS                                                                                                                                                                                                                       | Skip                                       |
| collectui.com, worldbranddesign.com                       | Client-rendered; no listing in HTML                                                                                                                                                                                                                    | Skip                                       |
| component.gallery                                         | Astro index of design-system components (reference, not a feed)                                                                                                                                                                                        | Skip                                       |
| visuelle.co.uk                                            | WP REST returned 0 posts; not pursued                                                                                                                                                                                                                  | n/a                                        |
| posterlad.com / gallery.so / shopify.com/examples / pi.co | Print shop / NFT gallery app / static brand examples / redirects to om.co                                                                                                                                                                              | Skip                                       |
| webgl.gallery, inspo.gallery                              | NXDOMAIN                                                                                                                                                                                                                                               | n/a                                        |

**Terms:** I didn't read each site's ToS. The robots and Content-Signal notes above are paraphrased from the actual files. Practical norm for all of these: images stay © the original creators, so show them as hotlinked thumbnails that link back to the gallery post and to the original studio, and don't re-host them.

**Implementation notes for the Convex fetcher:**

- Three patterns cover most of the good sources: **WordPress REST** (`/wp-json/wp/v2/posts?_embed`), **RSS with inline `<img>`/`<video>`**, and **one-off open JSON/GraphQL** (typo/graphic, showreel, The Brand Identity, Rive, Lottie).
- Nothing needs cookies or JS.
- Only typewolf, Readymag and Codrops' CDN reacted to the UA string. Send a normal browser UA anyway.
- For sources without dates (logosystem, Astro, designspiration), keep a seen-set of IDs and treat new IDs as new.
- Dates can be recovered from Mongo ObjectIds (typo/graphic poster ids, Gumlet asset ids for 60fps): `int(id[:8], 16)`.

## Example records (2 per usable site)

### fontsinuse (10 items)

- **Die neue Polis book series** — https://fontsinuse.com/uses/80842/die-neue-polis-book-series  
  media: image: https://assets.fontsinuse.com/static/use-media-items/308/307346/upto-700xauto/6aec52c4/0901-die-neue-polis-nzz-unfolded-1.jpeg; image: https://assets.fontsinuse.com/static/use-media-items/308/307347/upto-700xauto/6ad37621/0901-die-neue-polis-nzz-unfolded-4.jpeg; image: https://assets.fontsinuse.com/static/use-media-items/308/307348/upto-700xauto/6ad37621/0901-die-neue-polis-nzz-unfolded-7.jpeg  
  tags: Neue Zürcher Zeitung · date: Thu, 05 Nov 2026 09:55:29 +0000
- **Mihiderka** — https://fontsinuse.com/uses/80751/mihiderka  
  media: image: https://assets.fontsinuse.com/static/use-media-items/307/306978/upto-700xauto/6aec4a69/post-01.png; image: https://assets.fontsinuse.com/static/use-media-items/307/306979/upto-700xauto/6ad0eae1/post-05.png; image: https://assets.fontsinuse.com/static/use-media-items/307/306980/upto-700xauto/6ad0eae3/post-06.png  
  tags: — · date: Thu, 05 Nov 2026 09:10:21 +0000

### typographicposters (10 items)

- **ETHNOKINO** — https://www.typographicposters.com/kai-matthiesen/6aec4cb06ccebf337cc5279e  
  media: image: https://images.typographicposters.com/poster-2x/kai-matthiesen/kai-matthiesen-poster-0asqcpkx622yzfrc.jpg (w1132); video: https://assets.typographicposters.com/animated-poster/kai-matthiesen/kai-matthiesen-animated-8zqz841fx7pvwmfc.mp4 (1132x1414)  
  tags: film festival, poster, eye poster, festival, graphic design, custom typography, ethnokino, duotone · date: 2026-11-05 (ObjectId) · {"designer": "Kai Matthiesen", "year": 2026}
- **Constructing Posters** — https://www.typographicposters.com/babyinktwice/6a4608cd0bbde8ef2dec5ce6  
  media: image: https://images.typographicposters.com/poster-2x/babyinktwice/babyinktwice-poster-5ss320rf4z5jkpq8.jpg (w1132); video: https://assets.typographicposters.com/animated-poster/babyinktwice/babyinktwice-animated-q0nw8rv7pgbdpq7b.mp4 (2160x3840)  
  tags: exhibition, graphicdesign, typography, japan · date: 2026-07-02 (ObjectId) · {"designer": "Dafi Kühne", "year": 2026}

### brandidentity (10 items)

- **A sub-45-minute 10K gave Tinloof the concept for Enroute’s identity** — https://the-brandidentity.com/project/a-sub-45-minute-10k-gave-tinloof-the-concept-for-enroutes-identity  
  media: video: https://fls-a308a4a0-40a0-4df8-8dbb-117b4b947e86.laravel.cloud/articles/2026/11/a-sub-45-minute-10k-gave-tinloof-the-concept-for-enroutes-identity/Enroute-Tinloof-01.mp4  
  tags: 3D, App, Brand Guidelines, Digital, Identity, Logo, Motion, Sign · date: 2026-11-06T06:00:00+04:00
- **Jan Eumann on why Koto Berlin won’t stamp “a Koto look onto everything”** — https://the-brandidentity.com/interview/jan-eumann-on-why-koto-berlin-wont-stamp-a-koto-look-onto-everything  
  media: image: https://fls-a308a4a0-40a0-4df8-8dbb-117b4b947e86.laravel.cloud/articles/2026/11/jan-eumann-on-why-koto-berlin-wont-stamp-a-koto-look-onto-everything/Koto-Berlin-01.jpg (w2000)  
  tags: Advertising, Billboard, Digital, Identity, Illustration, Logo, Motion, Social Media · date: 2026-11-05T06:00:00+04:00

### itsnicethat (12 items)

- **Accidental Collage is a celebration of noticing the hidden worlds of printed ephemera, torn posters and bygone advertising** — https://www.itsnicethat.com/articles/dr-me-waiting-room-press-accidental-collage-advertising-publication-project-051126  
  media: image: https://m.itsnicethat.com/original_images/Accidental_Collage_DR.ME_15.jpeg?class=w1440 (4233x5200)  
  tags: Work, Advertising, Publication, Book, Poster, Collage, Archive, Environmentalism · date: 2026-11-05T10:00:00+00:00 · {"kind": "Article"}
- **A lived-in approach to sportswear shapes Figur’s graphic systems for brands like Hoka, Sap and Unna** — https://www.itsnicethat.com/articles/figur-graphic-design-discover-041126  
  media: image: https://m.itsnicethat.com/original_images/Screenshot_2026-10-28_at_12.57.33.png?class=w1440 (1140x1554)  
  tags: Work, Graphic Design, 3D, Logo, Identity, Art Direction, Sport, Branding · date: 2026-11-04T09:00:00+00:00 · {"kind": "Article"}

### brandnew (10 items; first one was a Job Board post, so it is dropped here)

- **New Logo for giffgaff** — https://www.underconsideration.com/brandnew/archives/new_logo_for_giffgaff.php  
  media: image: https://www.underconsideration.com/brandnew/wp/wp-content/uploads/2026/11/giffgaff_logo_before_after.png  
  tags: Before-After, Spotted, Telecom, black, bold, ligature, lowercase, sans serif · date: 2026-11-05T10:17:00
- **New Logo and Identity for Tenarai by Lippincott** — https://www.underconsideration.com/brandnew/archives/new_logo_and_identity_for_tenarai_by_lippincott.php  
  media: image: https://www.underconsideration.com/brandnew/wp/wp-content/uploads/2026/11/tenarai_logo_before_after.png  
  tags: Before-After, Corporate, Spotted · date: 2026-11-05

### bpando (10 items)

- **Mother Design pilfers from Y2K aesthetics and cymatic patterns in its masterful identity for spirituality app Purple Garden** — https://bpando.org/2026/11/05/mother-design-brand-identity-spirituality-app-purple-garden/  
  media: image: https://bpando.org/wp-content/uploads/purple-garden-mother-design-branding-identity-design-bpo-review-video1.png (426x240, a weak featured image; the post also has inline MP4s: https://bpando.org/wp-content/uploads/purple-garden-mother-design-logo-loop.mp4, …-charged-objects-app.mp4, …-long-form-layout.mp4)  
  tags: Art and Design, Fitness, Health and Beauty, Technology, App Logos, Brand Identity, Brand Identity Reviews, Branding, Branding Blog · date: 2026-11-05T09:15:13
- **Tied With Care** — https://bpando.org/2026/11/04/tied-with-care/  
  media: image: https://bpando.org/wp-content/uploads/julia-hey-ribbon-wordmark.jpg (3580x2000)  
  tags: BP&amp;O Voices, Packaging · date: 2026-11-04T09:15:00

### mindsparkle (10 items)

- **A lucky-seven type system turns bad luck into riso-printed fortunes** — https://mindsparklemag.com/designs/a-lucky-seven-type-system-turns-bad-luck-into-riso-printed-fortunes  
  media: image: https://mindsparklemag.com/storage/media/32368/fortune-charms-type-design-lettering-riso-fortune-card-device-lfd-mindsparkle-mag-cover-1.jpg  
  tags: — · date: Thu, 05 Nov 2026 14:45:00 +0000
- **Meer Mohsin** — https://mindsparklemag.com/website/meer-mohsin  
  media: image: https://mindsparklemag.com/storage/media/32655/slide-1.jpg  
  tags: — · date: Thu, 05 Nov 2026 06:00:00 +0000

### abduzeedo (10 items)

- **Inside Téléfilm Canada: Brand Identity by Caserne** — https://abduzeedo.com/inside-telefilm-canada-brand-identity-caserne/  
  media: image: https://cms.abduzeedo.com/sites/default/files/originals/hero_tlfilm-caserne.jpg  
  tags: — · date: Thu, 05 Nov 2026 23:06:48 GMT
- **Editorial Design: GridType Vol. 1 by Slanted Publishers** — https://abduzeedo.com/editorial-design-gridtype-vol-1-slanted-publishers/  
  media: image: https://cms.abduzeedo.com/sites/default/files/originals/hero_gridtype-vol-1-type-tools-slanted-publishers.jpg  
  tags: — · date: Thu, 05 Nov 2026 20:11:49 GMT

### inspgrid (10 items)

- **The Luxury of Time: Retiro Branding by Opera Prima** — https://theinspirationgrid.com/the-luxury-of-time-retiro-branding-by-opera-prima/  
  media: image: https://inspgr.id/app/uploads/2026/11/branding-retiro-feature.jpg (1680x1186)  
  tags: Branding, Graphic Design, Logo Design, Packaging Design, Print Design, Typography, beige, brand · date: 2026-11-05T20:01:49
- **Wild Personalities: Animal Portraits by Marvin Heinzel** — https://theinspirationgrid.com/wild-personalities-animal-portraits-by-marvin-heinzel/  
  media: image: https://inspgr.id/app/uploads/2026/11/photography-marvin-heinzel-feature.jpg (1680x1186)  
  tags: Photography, animal, animals, bird, birds, close-up, composition, contrast · date: 2026-11-05T20:00:22

### dieline (10 items)

- **What’s In That Reused Lala Crema Tub? Mexican Households No Longer Have To Guess** — https://thedieline.com/whats-in-that-reused-lala-crema-tub-mexican-households-no-longer-have-to-guess/  
  media: image: https://thedieline.com/wp-content/uploads/2026/11/Screenshot-2026-11-05-at-9.10.26-AM.png (2130x1232)  
  tags: Design News &amp; Trends, Food Packaging, Sustainable Packaging, Conciergency, CPG Design, dairy, LALA, packaging design · date: 2026-11-05T14:19:23
- **This Spanish Winery Stamps Every Label by Hand** — https://thedieline.com/this-spanish-winery-stamps-every-label-by-hand/  
  media: image: https://thedieline.com/wp-content/uploads/2026/11/Artiga_projecte_01_low_res.jpg (1600x1067)  
  tags: Wine &amp; Champagne Packaging, alcohol, Artiga, Artisanal, beverage, brand identity, Bulldog Studio, Cabrils · date: 2026-11-05T13:15:36

### creativeboom (10 items)

- **Tomáš Brousil on how to choose typefaces that work in the real world** — https://www.creativeboom.com/insight/tomas-brousil-on-what-separates-a-true-type-system-from-a-merely-large-font-family/  
  media: image: https://media.creativeboom.com/9cbc37db-e4f1-44b7-85c7-40793f66d5f8/conversions/06a317ffc741dd52c8423a1447b1630f67b00d7a-medium.webp; image: https://media.creativeboom.com/0cc3b2a7-7668-40f0-b8e1-41c4ff14b5c4/conversions/9ce7bbb57b57ee3155355d84bed228bad5b2c97d-medium.webp; image: https://media.creativeboom.com/36d27e72-000e-4159-abb1-7def19fd58cf/conversions/df7487a7d3abb7173c07a78a5364c2744110a396-medium.webp  
  tags: Insight · date: Thu, 05 Nov 2026 17:00:00 +0000
- **Step inside Hang Yu's wonderfully strange world of clowns, costumes and constructed identities** — https://www.creativeboom.com/inspiration/step-inside-hang-yus-wonderfully-strange-world-of-clowns-costumes-and-constructed-identities/  
  media: image: https://media.creativeboom.com/93b25328-93fb-49ed-9e7b-cb60d4935ba9/conversions/5cac1e8c0e795dba6a5ac49ba926e024e467e64f-medium.webp; image: https://media.creativeboom.com/f411c106-b0b7-4cfd-b3f1-735e4bff23c0/conversions/3891ea295327d52dc3edee277e29b5850b4981ac-medium.webp; image: https://media.creativeboom.com/3b7796bf-4461-4a33-8040-b6506b56eb02/conversions/37247b58d955b4148735767f65c27db2e04bed95-medium.webp  
  tags: Inspiration · date: Thu, 05 Nov 2026 14:00:00 +0000

### trendlist (10 items)

- **UN/SEEN—Women in Graphic Design up to the Bauhaus** — https://trendlist.org/images/un-seen-women-in-graphic-design-up-to-the-bauhaus  
  media: image: https://trendlist.org/img/images/big/un-seen-women-in-graphic-design-up-to-the-bauhaus-by-san-serriffe-trend-list-20261106-1.jpg (w325)  
  tags: Repetition, Gradients · date: 2026-11-06 · {"designer": "Julia Neller", "original": "https://san-serriffe.com/product/un-seen-women-in-graphic-design-u/", "colors": ["black", "white", "red", "purple"]}
- **Natalia Ruhe: Grain** — https://trendlist.org/images/natalia-ruhe-grain  
  media: image: https://trendlist.org/img/images/big/natalia-ruhe-grain-by-san-serriffe-trend-list-20261106-1.jpg (w325)  
  tags: Letterspace, Blank Cover · date: 2026-11-06 · {"designer": "Natalia Ruhe", "original": "https://san-serriffe.com/product/natalia-ruhe-grain/", "colors": ["orange"]}

### motionographer (10 items)

- **I’M HAVING A BREAKDOWN: DREAMCAT, the monster that wasn’t his** — https://motionographer.com/2026/11/04/im-having-a-breakdown-dreamcat-the-monster-that-wasnt-his/  
  media: image: https://motionographer.com/wp-content/uploads/2016/11/Dreamcat-ezgif.com-optimize.gif (600x250); inline video: https://motionographer.com/wp-content/uploads/2026/11/dreamcat-making-of.mp4  
  tags: breakdown, General · date: 2026-11-04T08:10:59
- **The Haunted Hotel That Sings Back: Anil Glendinning on There Are No Ghosts at the Grand** — https://motionographer.com/2026/11/02/the-haunted-hotel-that-sings-back-there-are-no-ghosts-at-the-grand/  
  media: image: https://motionographer.com/wp-content/uploads/2026/11/trimgost-ezgif.com-optimize.gif (600x338)  
  tags: General · date: 2026-11-02T13:51:39

### showreel (10 items)

- **Aixsponza Design Reel** — https://showreel.design/videos/aixsponza-aixsponza-design-reel  
  media: video (preview loop): https://video.showreel.design/Thumbnails/thumbnail_videos_aixsponza-aixsponza-design-reel.mp4; image (poster): https://video.showreel.design/Posters/poster_videos_aixsponza-aixsponza-design-reel.jpg (854x480 actual; served as video/mp4)  
  tags: 3D / CGI, 3d-cgi, minimal-clean, advertising-commercial · date: 2026-11-02T00:00:00.000Z · {"author": "Aixsponza"}
- **Justin Lemmon - Reel** — https://showreel.design/videos/justin-lemmon-justin-lemmon-reel  
  media: video (preview loop): https://video.showreel.design/Thumbnails/thumbnail_videos_justin-lemmon-justin-lemmon-reel.mp4; image (poster): https://video.showreel.design/Posters/poster_videos_justin-lemmon-justin-lemmon-reel.jpg (854x480 actual; served as video/mp4)  
  tags: Motion Graphics, 3d-cgi, hand-drawn, retro-vintage, advertising-commercial, entertainment-media · date: 2026-11-02T00:00:00.000Z · {"author": "Justin Lemmon"}

### 60fps (10 items)

- **DOOD Splash Animation** — https://60fps.design/shots/dood-splash-animation  
  media: video: https://video.gumlet.io/66b49d08225b7b88f78b7b44/6ad76a16e59c41063b892b8a/main.mp4; image (poster): https://video.gumlet.io/66b49d08225b7b88f78b7b44/6ad76a16e59c41063b892b8a/thumbnail-1-0.png?width=800  
  tags: — · date: 2026-10-20 (gumlet asset ObjectId) · {"app": "DOOD"}
- **Whatnot Splash Animation** — https://60fps.design/shots/whatnot-splash-animation  
  media: video: https://video.gumlet.io/66b49d08225b7b88f78b7b44/6ad76a1be59c41063b892b96/main.mp4; image (poster): https://video.gumlet.io/66b49d08225b7b88f78b7b44/6ad76a1be59c41063b892b96/thumbnail-1-0.png?width=800  
  tags: — · date: 2026-10-20 (gumlet asset ObjectId) · {"app": "Whatnot"}

### rive (10 items)

- **Galactic Outlaws** — https://rive.app/community/files/28899-54865-galactic-outlaws/  
  media: video: https://public.rive.app/community/videos/28899-54865-galactic-outlaws.mp4 (500x500); image (thumb): https://public.rive.app/community/video-thumbnails/28899-54865-galactic-outlaws.png  
  tags: blindbox, characters, galaxy, game, scifi, space · date: 2026-10-01T11:29:25.000Z · {"author": "Dimamoiseenko"}
- **Sobo** — https://rive.app/community/files/28761-54484-sobo/  
  media: video: https://public.rive.app/community/videos/28761-54484-sobo.mp4 (1600x1200); image (thumb): https://public.rive.app/community/video-thumbnails/28761-54484-sobo.png  
  tags: aiassistant, characters, mascot · date: 2026-09-09T11:52:26.000Z · {"author": "Patgrivet"}

### lottie (10 items)

- **Rolling Cubes** — https://lottiefiles.com/animations/rolling-cubes-WXrwwxymYB  
  media: video: https://assets-v2.lottiefiles.com/a/6fec0b15-a531-40ee-929c-391ea4e5a533/o8MHMxHFxl.mp4; image/gif: https://assets-v2.lottiefiles.com/a/6fec0b15-a531-40ee-929c-391ea4e5a533/muVXnevSn3.gif; image (still): https://assets-v2.lottiefiles.com/a/6fec0b15-a531-40ee-929c-391ea4e5a533/S2LUbbuZeY.png  
  tags: — · date: 2026-10-04T05:58:34.707Z · {"author": "sanjibpaul"}
- **Moods** — https://lottiefiles.com/animations/moods-bTrdL1ydDQ  
  media: image (still): https://assets-v2.lottiefiles.com/a/5fb3a6dd-18a2-419c-90a2-3a5ff4a4d080/s6LYlXJ6m7.png; lottie: https://assets-v2.lottiefiles.com/a/5fb3a6dd-18a2-419c-90a2-3a5ff4a4d080/bTrdL1ydDQ.lottie  
  tags: — · date: 2026-09-29T05:42:15.094Z · {"author": "sanjibpaul"}

### spline (7 items)

- **AI Assisted Drone 3d Model** — https://community.spline.design/file/18236bd6-2c56-4285-a25b-c5a1579ff5ea  
  media: image (scene preview): https://community-filepreview.spline.design/18236bd6-2c56-4285-a25b-c5a1579ff5ea.jpg  
  tags: AI, Claude, Drone, Tech, Animation · date: 2026-10-24 · {"author": "polishchuk", "kind": "3D scene"}
- **mobile** — https://community.spline.design/file/324880d2-0e99-48e5-9f97-9f7b7d10616c  
  media: image (scene preview): https://community-filepreview.spline.design/324880d2-0e99-48e5-9f97-9f7b7d10616c.jpg  
  tags: mobile, and · date: 2026-11-02 · {"author": "amir1375226", "kind": "3D scene"}

### codepenspark (10 items)

- **Floating Block v1** — https://codepen.io/editor/DMajor4DearDaniel/pen/01a16203-1aa7-705b-abd0-ce35040882e6  
  media: image (static screenshot): https://production-codepen-email-assets.codepenassets.com/cdn-cgi/image/width=600,quality=90,format=auto/codepen-spark/floating-block-v1.png (w600)  
  tags: — · date: Thu, 05 Nov 2026 00:00:00 GMT
- **Alone** — https://codepen.io/editor/mielalabs/pen/01a17129-d3f7-771a-ac1a-2a80eacce7ae  
  media: image (static screenshot): https://production-codepen-email-assets.codepenassets.com/cdn-cgi/image/width=600,quality=90,format=auto/codepen-spark/alone-yorganci.png (w600)  
  tags: — · date: Thu, 05 Nov 2026 00:00:00 GMT

### threejs (10 items)

- **Mycelium Incursion – an arcade shooter inside a spinning space colony (Three.js WebGPU, shipping on Steam)** — https://discourse.threejs.org/t/mycelium-incursion-an-arcade-shooter-inside-a-spinning-space-colony-three-js-webgpu-shipping-on-steam/96256  
  media: image: https://canada1.discourse-cdn.com/flex035/uploads/threejs/optimized/3X/e/e/eeba487e54b9a5d1bb086704c9ffabf611cad39a_2_1024x639.jpeg  
  tags: game, game-dev, game-engine · date: 2026-11-01T22:26:12.004Z
- **Sand-racer: real-time sand simulation & terramechanics in WebGPU (three.js r187 + TSL)** — https://discourse.threejs.org/t/sand-racer-real-time-sand-simulation-terramechanics-in-webgpu-three-js-r187-tsl/96255  
  media: image: https://canada1.discourse-cdn.com/flex035/uploads/threejs/optimized/3X/1/a/1ac044c226a99cf190625841b8d05fab0ea966f3_2_1024x533.gif  
  tags: — · date: 2026-11-01T22:25:26.128Z

### vimeo (10 items)

- **Something Greater than You** — https://vimeo.com/channels/staffpicks/1242348473  
  media: image: https://i.vimeocdn.com/video/2220624966-3443a627169e7469fc7072984418323c6e9e55ec33c0967c7b4a4d74aec7bc9a-d_960?region=us (960x540); iframe player: https://player.vimeo.com/video/1242348473?h=e0d4ae13fb  
  tags: — · date: Thu, 05 Nov 2026 09:58:27 -0500
- **Stalin Boys** — https://vimeo.com/channels/staffpicks/1242476309  
  media: image: https://i.vimeocdn.com/video/2220842278-a14ceea2fde6503383a9b7090be52d6372f5fa13e012038a90658e87c40cbc6a-d_960?region=us (960x540); iframe player: https://player.vimeo.com/video/1242476309?h=04bb30474b  
  tags: — · date: Wed, 04 Nov 2026 14:19:49 -0500

### identitydesigned (10 items)

- **Henri & Hélène** — https://identitydesigned.com/henri-helene/  
  media: image: https://identitydesigned.com/wp-content/uploads/2026/11/henri-helene-identity-05.jpg (2200x1589)  
  tags: All features, Goodside, Austin, United States, Food and drink · date: 2026-11-05T15:57:49
- **WHEN** — https://identitydesigned.com/when/  
  media: image: https://identitydesigned.com/wp-content/uploads/2024/12/21-WHEN-preview.jpg (500x433)  
  tags: All features, Universal Favourite, Sydney, Healthcare · date: 2024-12-16T12:15:43

### astro (10 items)

- **Day of the Dead** — https://dayofthedead.holiday/  
  media: image (webp screenshot): https://astro.build/_astro/day-of-the-dead.gVZUpvCS_1CUncF.webp (800x450)  
  tags: — · date: None
- **Designcember** — https://designcember.web.app/  
  media: image (webp screenshot): https://astro.build/_astro/designcember.CTgEp-Qe_Z17auK4.webp (800x454)  
  tags: — · date: None

### logosystem (10 items; 1,383 logos in payload)

- **aprile** by Sublimio — https://logosystem.co/logo/aprile (original: https://www.sublimio.com/aprile/)  
  media: image: https://cdn.logosystem.co/works/870d2096-0e01-420e-ac40-cf2ba2314a6c-2572a894.jpg (1200x1200)  
  tags: Minimal, Geometric, Monoline, infinity, minimalist, monoline, modern, sleek · date: newRank 0 (Latest additions)
- **Att1tud** by Sublimio — https://logosystem.co/logo/att1tud-3 (original: https://www.sublimio.com/rejected-logo-designs-we-still-love/)  
  media: image: https://cdn.logosystem.co/works/870d2096-0e01-420e-ac40-cf2ba2314a6c-e415ae09.jpg (1200x1200)  
  tags: Geometric, Minimal, Bold, Monoline, letter-a, geometric, negative-space, tech · date: newRank 1 (Latest additions)
- animated example media: video: https://cdn.logosystem.co/animated/1vision-tech.mp4 (`video_url` field)
