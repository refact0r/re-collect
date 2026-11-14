# Discovery feed — research and prototype (2026-11-04 → 2026-11-14)

Research for the re-collect 2.0 "discovery" pillar: a feed of outside content
tuned to the user's taste, where kept candidates become library items. A
first prototype is built (`aff840c`, at `/discover`); see "Prototype" below.

**How this was gathered:**

- Every source was probed with curl from a residential IP between 2026-11-04
  and 2026-11-13. Convex actions run from datacenter IPs, so check each v1
  source from a Convex action before relying on it.
- Prices were checked on official pages the same day unless marked
  _unverified_.
- Raw notes from the research agents, each with example records, are in
  `reference/discovery-notes/`:
  - `sources-A/B/C.md`: the user's 24 sources.
  - `x-twitter.md`: X, Grok, Bluesky and Mastodon options.
  - `extra-sources-embeddings.md`: extra sources, embedding APIs, Convex
    vector limits and Browser Rendering pricing.
  - `embedded-A/B.md`: about 80 galleries with data in the page.
  - `arena-channels.md`: the Are.na channels scouted for the feed, with
    runners-up and rejects.
  - `user-sources-cost.md`: what it would cost to let users add their own
    sources.
- Those notes mention extraction scripts in a session scratchpad. The
  scratchpad is gone; the recipes that matter are in §1b.

This file is the synthesis and stays current. Where it disagrees with a raw
note, this file wins.

## TL;DR

- **No screenshots needed for v1.** Plenty of good sources ship their own
  image or video URLs, readable with a plain `fetch`. Prefer those, hotlink
  the media, and only copy into R2 when an item is kept.
- **From the user's list, the fetchable keepers are:** Awwwards (RSS),
  Siteinspire (RSS, an extra), One Page Love (RSS), minimal.gallery (RSS),
  Seesaw (catalog in the page) and Recent (the new Godly; open JSON API).
  - Recent's _websites_ feed has been stale since July 2026. Its **X feed** is
    the valuable part: about 4 curated design posts from X a day.
  - MaxiBestOf is walled for servers, but its paid Pro MCP server is
    reachable.
  - Dribbble, landing.love, Lapa Ninja and Land-book's pages are bot-walled.
    dark.design, Stacksorted, a-fresh and loadmo.re are dead. Mobbin and
    Refero are paywalled reference tools.
- **Good finds beyond the list:**
  - Websites: curated.design, inspo.page.
  - Type, branding and posters: Fonts In Use, The Brand Identity, It's Nice
    That, typographicposters.com, BP&O.
  - Hand-curated: **Are.na channels**, the closest fit to how re-collect is
    used.
- **Dedupe aggressively.** The website galleries feature the same studio and
  SaaS homepages over and over. Dedupe by normalized URL. Being featured by
  several galleries is a quality signal.
- **X/Twitter:**
  - Use Recent's curated X feed for free discovery.
  - Optionally read your own bookmarks through the official pay-per-use API,
    about $1–3/mo.
  - Paid X discovery ($10–40/mo) only if that isn't enough. Grok can't build
    a feed (no image URLs). Nitter is dead. Scrapers break X's terms.
- **Are.na:** polling chosen channels (or your follow feed) is fine and
  tested (§1, "Are.na channels"). Bulk scraping à la River is against their
  rules; ask them instead. The user has put bulk off for now.
- **Ranking:** score each candidate by kNN similarity to the library, plus a
  skip penalty, ~20% exploration and a cap per source.
  - The model pick moved to `reference/embeddings-research.md`:
    EmbeddingGemma 2, fallback Gemini Embedding 2.
  - Cost rounds to zero.
  - The prod library is only ~93 items, so the taste signal starts small.
- **The real constraint is Browser Rendering's free plan, not money.** It
  allows about 40 screenshots a day, which is another reason to rely on
  sources' own media.

## Decisions and status (from the discussion)

| Topic                                    | Where it stands                                                                                                                                                                                                  |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Screenshots or re-hosting for feed items | **No.** Use each source's own media; copy to R2 only on keep                                                                                                                                                     |
| "No embedding"                           | Asked whether this also rules out taste-ranking vectors; **unanswered**. If it does, rank by tag overlap (source tags + our AI tags)                                                                             |
| MaxiBestOf                               | The user likes it. Options: Pro MCP ($9/mo, $72/yr, $179 lifetime), or email the owner (Bertrand Bruandet) because their documented public API is Cloudflare-blocked. **Undecided**                              |
| Dribbble / Behance bypass                | Not doing it: bot walls plus terms. Behance featured RSS is fine; Dribbble and Behance profile pages load but are against their terms                                                                            |
| Bulk Are.na (River-style)                | **Out for now.** The sanctioned route is emailing help@are.na                                                                                                                                                    |
| Specific Are.na channels                 | **Yes.** 11 channels in `SOURCES` (20 scouted, 9 cut by eye), in three groups (`discovery-notes/arena-channels.md`). A follow feed (`/v3/me/feed`) would need per-user tokens; not now                           |
| Pool model                               | **Curated pool (2026-11-14).** Sources live in code; everyone reads one shared pool; users only toggle sources. User-added sources later, if wanted (`user-sources-cost.md`)                                     |
| Feed order                               | **Plain round-robin for now,** no taste ranking: too little volume for River-style embedding. Each source (or Are.na group) gets one slot per round                                                              |
| Keeping                                  | **Browse, not triage (2026-11-14).** No skip or accept/reject: you scroll past what you don't want. Clicking a card opens a modal with the media and an "add to" list (library or a collection, last used first) |
| X posts (via Recent)                     | **Keep as image items** linking back to the post, not link items                                                                                                                                                 |
| Video                                    | **No video item type yet.** The feed plays the source's MP4. Keeping saves the poster frame as an image, and tagging runs on that frame. A video type would be its own feature                                   |
| Already-saved links                      | **Hidden from the feed** via `items.normUrl` (`by_user_normUrl` index)                                                                                                                                           |
| Multi-user                               | Shipped. The candidate pool is global, with per-user source toggles; added cards drop out through the user's own library                                                                                         |
| Scope (websites only vs broader visual)  | **Open**; see §6                                                                                                                                                                                                 |

## Prototype (2026-11-13, curated pool since 2026-11-14)

A first feed to get a feel for it, at `/discover`. It has no taste ranking:
there isn't enough volume for River-style embedding, so it's a plain mix.

**Model: one curated pool.** The sources are a list in code; every user reads
the same shared pool and can turn sources off for their own feed. Users can't
add sources or trigger polls, so polling cost doesn't grow with users. We
chose this over per-user sources for now; the cost estimate for letting each
user add 3–5 sources (cheap once polling is staggered and bounded, but the
current code breaks at around 100 users) is summarized at the end of this
section, in full in `discovery-notes/user-sources-cost.md`.

- **Sources:** `SOURCES` in `src/convex/lib/discoverySources.ts`, one adapter
  per source kind. Add or remove a source there and deploy.
  - Covered: Recent's X feed, Seesaw, typographicposters, and 11 Are.na
    channels. Awwwards, One Page Love and Siteinspire come in over RSS.
    Recent's launch feed was dropped in the by-eye review (2026-11-14).
  - The Are.na channels were scouted on 2026-11-14 and are listed, with
    runners-up and rejects, in `discovery-notes/arena-channels.md`. They sit
    in three groups (web, motion & code, graphic & type). Each group takes
    one feed slot per round like a single source, so the channels don't drown
    out the other sources.
  - Awwwards and One Page Love entries get one fetch each to resolve the
    original site. Siteinspire's detail pages are bot-walled, so its entries
    link to Siteinspire.
  - Are.na calls send `ARENA_TOKEN` (a personal access token, Convex env var)
    when it's set. Without it they run as a guest, at 30 requests a minute per
    shared Convex IP.
- **Backend:** `src/convex/discovery.ts`, with three tables:
  - `discoveryCandidates`: the shared pool, deduped by normalized URL.
  - `discoverySources`: poll state only (last poll, last error).
  - A cron polls every source every 6 hours.
  - Each user's turned-off sources are `hiddenSources` on their `discover`
    viewPreferences row.
- **Keeping:** `src/convex/discoveryKeep.ts` copies the source's image into R2
  and adds an ordinary item. A website becomes a URL item. Anything else
  becomes an image item linking back: an X post from Recent, a poster, an
  Are.na image.
- **Feed order:** round-robin across sources (or source groups), newest first
  within a round.
  Saved links drop out only after dealing, so adding one doesn't reshuffle
  the rest.
- **Hiding saved links:** links already in your library are left out by an
  indexed lookup on `items.normUrl`. The feed checks only the cards on the
  page, not the whole library.
- **Page:** the same masonry grid as collection pages (`src/lib/masonry.ts`,
  filled row by row, with the +/- column control saved on the `discover`
  viewPreferences row) and a sources dropdown like the collection filter.
  Cards show only the media, the title and where it's from (the site, or
  "Are.na"); very tall media is cropped from the top. Clicking a card opens a
  modal with the full media, a link to the original and an "add to" list.
  A modified click opens the original. No keybinds. Video loops play only
  while on screen.
- **Video:** the app has no video item type. In the feed, a source's MP4 is
  hotlinked and played. Keeping saves only the poster frame, as an image
  item, and tagging runs on that frame.
- **Tests:** `src/convex/discovery.test.ts` covers the library check,
  and per-user source toggles.
- **Still prototype shortcuts:**
  - Every poll runs all sources at once (fine at ~10 sources).
  - Old candidates never expire.
- **Dev:** `npx convex run discovery:pollAll`, or
  `discovery:resetSource '{"key":"awwwards"}'` to re-fetch one source.

**If users get to add sources later** (estimate from 2026-11-14; details in
`discovery-notes/user-sources-cost.md`):

- **Cost:** about the Pro base ($25/month) up to 5,000 users × 5 sources,
  once polling is fixed.
- **Fixes needed first:**
  - Staggered per-source polling, with a next-poll time per source.
  - A per-source cursor, fetching 20 instead of 100 on routine polls.
  - Daily polling, with backoff for quiet sources.
  - A feed query limited to each user's own subscriptions.
  - Candidate expiry.
  - Caps on RSS feed size.
- **Without those:** the feed query passes Convex's 16 MiB read limit at
  ~300 sources, and `pollAll` fails at a few hundred.

## 1. Source matrix

"Plain fetch" means a Convex action can read it with no browser.

- **Risk** combines bot protection with what the site's terms and robots.txt
  say.
- **Verdict scale:** ★ = v1 pick, ✓ = usable later, ✗ = skip.

### The user's list

| Source                 | Access (best route)                                                                                                                                                                                                                                                                                                                       | What an entry gives                                                                                                                                                                                                                           | Volume                                                                                                                                                       | Risk                                                                                            | Verdict                                                                                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Awwwards**           | RSS `/feed/` (Sites of the Day); listing pages embed card JSON for nominees. Plain fetch, no bot wall                                                                                                                                                                                                                                     | 1600×1200 hotlinkable image, title, description, date, tags (category/tech/style). Original URL needs one fetch of `/sites/<slug>`                                                                                                            | 1 SOTD/day + ~20 nominees/day                                                                                                                                | robots.txt `Disallow: /feed`; terms bar "reproduction". Low for personal polling                | ★                                                                                                                                                |
| **Dribbble**           | AWS WAF challenge on every listing (popular, search, tags, shot pages); RSS 404; API only covers your own shots. **Designer profile pages (`/<user>`, `/<user>/shots`, `/<user>/collections`) return 200 to a plain fetch** (~25 shots each); `/<user>/likes` is 401                                                                      | Shot image (CDN, `?resize=` works), title, shot link. No date/tags; the shot is the work                                                                                                                                                      | — (popular); per-designer as they post                                                                                                                       | Terms ban scraping and bots outright, profiles included                                         | ✗ for "popular". Following a handful of designers via profile pages is possible but still against terms                                          |
| **MaxiBestOf**         | **Official public API `GET /api/websites?page=N` (no key, 32/page) is documented on `/developers`, but Cloudflare challenges it for every non-browser client** (their own curl example fails). **The Pro MCP server (`/mcp-server`, OAuth 2.0 + PKCE) is reachable server-side** (401, not a challenge). Weekly free newsletter (Mondays) | Richest metadata of any source (fonts, colours with usage %, tags, stack, section crops)                                                                                                                                                      | ~6/weekday, ~15k sites                                                                                                                                       | Low via the API or MCP; high via a browser                                                      | ✓ via Pro MCP ($9/mo, $72/yr or $179 lifetime; "unlimited during beta", docs also say 1,000 calls/mo) or ask the owner to unblock the public API |
| **Behance**            | Official "featured projects" RSS `/feeds/projects` (needs a Chrome UA). Profile pages (`/<user>`) also return 200 with project covers; gallery, search and project pages are challenged                                                                                                                                                   | 808px cover, title, description, date. No tags; the project is the work                                                                                                                                                                       | ~5/day                                                                                                                                                       | RSS is a provided interface; profile HTML parsing is not                                        | ✓ (good if you want branding/3D/illustration)                                                                                                    |
| **minimal.gallery**    | RSS `/feed/` or WP REST `/wp-json/wp/v2/posts`                                                                                                                                                                                                                                                                                            | 1920px image, tags. Original URL needs one HTML fetch                                                                                                                                                                                         | ~1/day                                                                                                                                                       | Legal page forbids scraping and bulk image download: read the RSS, hotlink, don't mirror        | ★                                                                                                                                                |
| **Dark Mode Design**   | RSS `/websites/rss.xml`                                                                                                                                                                                                                                                                                                                   | 1440×1080 image, original URL in the description, date. No tags                                                                                                                                                                               | 15–20/month in fortnightly batches                                                                                                                           | Low (no terms page)                                                                             | ✓ (one aesthetic, mixed quality)                                                                                                                 |
| **dark.design**        | Whole catalog (247 sites) is in the homepage HTML                                                                                                                                                                                                                                                                                         | screenshot, title, URL                                                                                                                                                                                                                        | Nothing new since Aug 2026                                                                                                                                   | Low                                                                                             | ✗ (one-off import at most)                                                                                                                       |
| **Refero**             | Open undocumented JSON `/v1/sites/available`                                                                                                                                                                                                                                                                                              | 1440×900 screenshot, original URL, category, palette                                                                                                                                                                                          | Free set is 439 sites, a few/week                                                                                                                            | Terms forbid bulk extraction; core is paywalled                                                 | ✗ (mainstream SaaS reference)                                                                                                                    |
| **Stacksorted**        | All 180 entries hard-coded in the JS bundle                                                                                                                                                                                                                                                                                               | UI-element category, clip, URL                                                                                                                                                                                                                | Unchanged since Mar 2025                                                                                                                                     | Low                                                                                             | ✗ (one-off import at most)                                                                                                                       |
| **landing.love**       | Cloudflare 403s every non-browser request (robots.txt allows all)                                                                                                                                                                                                                                                                         | Video-first; original URL, date, 1440×1024 stills                                                                                                                                                                                             | 1–3/day                                                                                                                                                      | High (bot wall)                                                                                 | ✓ if Browser Rendering gets through (untested). Good curation                                                                                    |
| **Made in Webflow**    | JSON `/api/v1/marketplace/made-in-webflow/feed/{popular,recent}` (robots allows)                                                                                                                                                                                                                                                          | 540×360 thumbs, tags. Original URL on the detail page                                                                                                                                                                                         | "popular" barely changes; "recent" is ~25/day unfiltered                                                                                                     | Acceptable Use Policy forbids page scraping                                                     | ✗ (low-res, noisy)                                                                                                                               |
| **Landingfolio**       | Open JSON `landingfolio-2026.onrender.com/inspiration?page=N`                                                                                                                                                                                                                                                                             | Original URL, date, categories, 6-colour palette, full-page shots for each page type (landing, pricing, login…)                                                                                                                               | 3–4/week                                                                                                                                                     | Terms say not to copy any part of the site                                                      | ✓ (SaaS niche)                                                                                                                                   |
| **SaaS Landing Page**  | WordPress RSS + REST API                                                                                                                                                                                                                                                                                                                  | Huge tall PNG, tags, fonts; original URL in the HTML                                                                                                                                                                                          | 3–4/week                                                                                                                                                     | robots.txt says `ai-train=no`                                                                   | ✗ (generic SaaS)                                                                                                                                 |
| **Lapa Ninja**         | Only RSS `/index.xml` passes; pages and image CDN are behind Cloudflare                                                                                                                                                                                                                                                                   | Poster image, title, date; **no original URL**                                                                                                                                                                                                | ~6/week                                                                                                                                                      | High                                                                                            | ✗ (overlaps landing.love)                                                                                                                        |
| **One Page Love**      | RSS `/feed`                                                                                                                                                                                                                                                                                                                               | 1200×1200 hotlinkable screenshot, 5–12 style tags, written note. Original URL needs one HTML fetch                                                                                                                                            | ~10/week                                                                                                                                                     | robots.txt `Disallow: /feed/` even though the page advertises the feed; no anti-scraping clause | ★                                                                                                                                                |
| **Seesaw**             | Homepage embeds the whole catalog in its Next.js payload (893 sites, 3.7 MB HTML); categories and fonts are ID lookups in the same payload. **Tested 2026-11-05**                                                                                                                                                                         | Original URL, date, description, categories, font names; Cloudinary still (`video/upload/w_1440/<imgId>.jpg`, 1440×809) and loop (`w_640,du_3/q_auto:eco/<imgId>.mp4`), both hotlinkable; og image                                            | ~5/week, steady for a year (newest 2026-11-01)                                                                                                               | Low (robots allows all, no terms page)                                                          | ★ (strong curation)                                                                                                                              |
| **Godly → Recent**     | godly.website redirects to **recent.design**, which has an **open JSON API: `POST https://api.recent.design/rpc/items/list`** (oRPC, body `{"json":{feed, format, sort:"recent", limit, cursor}}`, cursor paging). **Tested 2026-11-05.** godly.design is a separate, newer Godly feed (X-post clips + sites, server-rendered)            | Title, category, typed tags (style/interaction/colour/stack), description, original URL or X post URL, creator, date, staff-pick flag, palette; MP4 renditions (up to 4K) + WebP posters on `cdn.recent.design`, hotlinkable, year-long cache | **Websites feed: nothing new since 2026-07-04.** X feed: ~4/day. Launch videos: ~1.5/day. App icons / OG images / App Store screenshots: stale since Jul–Sep | robots.txt allows all, bans AI crawlers, Content-Signal `ai-train=no`                           | ★ for the X feed; websites feed is stale                                                                                                         |
| **Mobbin**             | None legitimate for free. Pro MCP (~$10/mo) or Team REST API, 60 req/min                                                                                                                                                                                                                                                                  | Mobile/web app flows                                                                                                                                                                                                                          | —                                                                                                                                                            | Terms ban scrapers and bots                                                                     | ✗ (great reference, not a feed)                                                                                                                  |
| **a-fresh.website**    | HTML                                                                                                                                                                                                                                                                                                                                      | Thumbnail, `?ref=` original URL                                                                                                                                                                                                               | Unchanged for ~8 months; part of the archive is paywalled                                                                                                    | Low                                                                                             | ✗                                                                                                                                                |
| **Unbound by default** | HTML                                                                                                                                                                                                                                                                                                                                      | Good tags (style, interaction, stack); videos need a Referer                                                                                                                                                                                  | ~100 sites in bursts                                                                                                                                         | Low                                                                                             | ✗ (one-off import at most)                                                                                                                       |
| **Layers**             | `GET /api/v1/layers` with `Referer: https://layers.to/explore`                                                                                                                                                                                                                                                                            | 1600px PNG, author, date. No original link                                                                                                                                                                                                    | 20–50+/day                                                                                                                                                   | Medium                                                                                          | ✗ (Dribbble-style daily UI noise; maybe `view=top`)                                                                                              |
| **Land-book**          | Only `/rss.xml` passes; everything else is challenged                                                                                                                                                                                                                                                                                     | Title, date; unsigned full-page screenshot at `cdn.land-book.com/website/<id>/<hash>-screenshot.jpg`. No original URL, no tags                                                                                                                | ~5/weekday                                                                                                                                                   | Terms unreadable (behind challenge)                                                             | ✓ (middling taste, template ads)                                                                                                                 |
| **Spotted in Prod**    | Open JSON: `/api/posts/paginated`, `/api/posts/filters`, `/api/feed/today`                                                                                                                                                                                                                                                                | iOS app **interaction** clips (MP4), rich typed tags (gesture/flow/pattern), App Store links                                                                                                                                                  | 10–20 curated/month (+ community clips)                                                                                                                      | Low                                                                                             | ✓ (unique, but mobile interactions, not web)                                                                                                     |
| **loadmo.re**          | Server-rendered HTML, 13 pages; robots asks for a 10 s crawl delay                                                                                                                                                                                                                                                                        | Mobile-web screen recordings, original URL, tags                                                                                                                                                                                              | Nothing since Jan 2026                                                                                                                                       | Low                                                                                             | ✗ (one-off import at most)                                                                                                                       |

**Frank verdict.** The strong sources on the list are Awwwards, Recent,
Seesaw, One Page Love and minimal.gallery, plus MaxiBestOf if you pay for Pro. Dribbble, Refero, Lapa,
SaaS Landing Page, Made in Webflow, a-fresh and the dead ones aren't worth
building for. landing.love is good but walled. The web galleries mostly
feature the same thing: studio, portfolio and SaaS homepages. Five website
galleries give you about one-and-a-half galleries' worth of new content.

### Extra sources worth adding

| Source                                                       | Access                                                                                                                                                                                                                                     | Notes                                                                                                                                                                       | Verdict                              |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| **Are.na channels**                                          | REST v3 `/v3/channels/<slug>/contents` (no token for public channels; **send a descriptive UA** — anonymous or browser UAs get 403). Guest 30 req/min; free token 120/min                                                                  | Original image + sizes, title, `source.url`, dates. Find channels by snowballing: `/v3/blocks/<id>/connections` on blocks you already like → `/channels/<slug>/connections` | ★ best taste fit                     |
| **Siteinspire**                                              | RSS `/websites/feed`                                                                                                                                                                                                                       | 1600×1000 screenshots in `media:content`, fresh                                                                                                                             | ★                                    |
| **FWA winners**                                              | RSS `/feed/winners.xml`                                                                                                                                                                                                                    | Images in the feed, daily                                                                                                                                                   | ✓                                    |
| **Pinterest boards**                                         | Board RSS `pinterest.com/<user>/<board>.rss` (alive; rewrite `236x` → `736x`/`originals`)                                                                                                                                                  | Latest ~25 pins per board                                                                                                                                                   | ✓ cheap, if you have boards you like |
| **Mindsparkle, BP&O, It's Nice That (FeedBurner)**           | RSS with images                                                                                                                                                                                                                            | Branding/graphic design, editorial                                                                                                                                          | ✓ if you widen beyond websites       |
| **Museums**                                                  | Smithsonian Open Access (incl. **Cooper Hewitt**, free api.data.gov key), the Met (`/v1.1/search`; `/v1/search` is gone), Art Institute of Chicago (needs an `AIC-User-Agent` header), Cleveland, Rijksmuseum, Library of Congress posters | CC0 posters, type specimens and prints. Not time-based: sample by query (`poster`, `Bauhaus`, `specimen`) and let the ranker filter                                         | ✓ "evergreen" pool, nice later       |
| **Reddit**                                                   | `.json` is dead without auth and new OAuth apps need manual approval; subreddit RSS works but rate-limits after ~3 quick requests                                                                                                          | Weekly `top` RSS of r/DesignPorn, r/typography etc. Fragile from datacenter IPs                                                                                             | ✗ for v1                             |
| **Savee**                                                    | Official API, paid plan only                                                                                                                                                                                                               | Terms forbid building an embedding index from API data, so it can't be used for taste ranking                                                                               | ✗                                    |
| **Cosmos**                                                   | No API or RSS                                                                                                                                                                                                                              | —                                                                                                                                                                           | ✗                                    |
| **Sidebar, Product Hunt, hoverstat.es, Show HN**             | RSS without images                                                                                                                                                                                                                         | Need og:image (free, via the worker's plain-fetch path) or a screenshot (uses browser budget)                                                                               | later                                |
| **httpster, Brutalist Websites, Codrops, Web Design Museum** | Dead feeds or Cloudflare-walled                                                                                                                                                                                                            | —                                                                                                                                                                           | ✗                                    |

### Bulk Are.na and a River-style corpus (2026-11-12)

[River](https://river.maxbittker.com/) is Max Bittker's embedding browser.
You drift from image to image through nearest neighbours. Its frontend calls
its own backend (`/neighbors`, `/vectorNeighbors`, `/embed`). Per his
[notes](https://maxbittker.com/river-notes), the corpus is about 1M Are.na
images embedded with CLIP.

**Are.na's rules.** From the
[developer docs](https://www.are.na/developers):

- The API is "not for scraping or bulk data collection".
- Automated crawling and systematic downloading are prohibited.
- Bulk access is by request: email help@are.na with the use case.

The [terms](https://are.na/terms) let them restrict or cut off anyone doing
that. Their [API editorial](https://www.are.na/editorial/on-our-api) explains
why the rules are strict: scrapers strained their infrastructure, so they
added tiered rate limits, and v3 search is now premium-only. That editorial
also lists River among the projects they like, so the sanctioned path
evidently exists.

**Technically it's easy, so the obstacle is the rules.**

- **API calls:** about 1M blocks is ~10k paged calls. At the free tier's 120
  requests a minute, that's a couple of hours.
- **Downloads:** each image still has to be fetched from Are.na's CDN to be
  embedded, roughly 50–100 GB at medium size.
- **Embedding:** a few dollars with EmbeddingGemma 2, or days of CPU time
  with a local CLIP/SigLIP model.

**At 1M images, the vector store is the real design change.**

- 1M × 768-dim vectors is several GB.
- Convex bills every vector search at the full index size, so each River-style
  step would cost gigabytes of query budget. Convex is fine at library scale
  (thousands of vectors), but not here.
- A corpus this size belongs in a dedicated vector index, such as Cloudflare
  Vectorize on the existing Cloudflare account.

**Options, in order:**

1. **Ask Are.na.** Email help@are.na: personal, non-commercial, embeddings
   only, images hotlinked, every item linking back to its block. If re-collect
   goes multi-user, say so, since that changes the ask.
2. **Ask Max** whether River's neighbour API could be used, instead of
   building the corpus at all.
3. **Build a River-style pool from sources that allow bulk use:**
   - Smithsonian Open Access (including Cooper Hewitt) and the Met publish
     CC0 bulk datasets. _Not yet probed._
   - The discovery candidate pool from the galleries above grows by roughly
     50–150 items a day.
4. **Stay within "integration" scale on Are.na:** channels you pick, plus
   snowballing a few levels from blocks you've saved. That's hundreds of
   channels and tens of thousands of blocks, at polite rates with a
   descriptive User-Agent.

### Are.na channels as a source (tested 2026-11-13)

Polling chosen channels is ordinary integration use, and it works well. All
of this was tested unauthenticated against v3.

- **Polling a channel:**
  - Call `GET /v3/channels/<slug>/contents?per=100&sort=created_at_desc`.
  - The sort is by when each block was connected to the channel. Store the
    newest `connection.connected_at` per channel and stop paging once you
    reach it, so a quiet channel costs one request.
  - Responses carry an `ETag` and are cached for 5 minutes. A 304 still
    counts against the rate limit.
- **What a block gives:**
  - `type`: Image, Link, Text, Embed, Attachment or Channel.
  - Title, description, `source.url` (the original page), the block's own
    `created_at`, and `connection.connected_at` / `connected_by` (who added
    it to this channel, and when).
  - `image` comes with the original plus `small` (400px), `medium` (1200px)
    and `large` sizes, width, height, and sometimes a blurhash.
  - **Link blocks carry Are.na's own screenshot of the page.** Website links
    arrive with an image, so they need no capture.
- **Media:** `images.are.na` resized URLs load with no Referer and with a
  foreign one. They're cached for a year.
- **Filter by type.** Keep Image and Link blocks with an image. Drop Text,
  Attachment and Channel blocks; a Channel block is a nested channel, which
  is a discovery hint, not an item.
- **Finding channels:**
  - `GET /v3/blocks/<id>/connections` lists every channel containing a block.
    For one test image, that gave 9 channels from 9 different curators.
  - `GET /v3/channels/<slug>/connections` lists channels that contain this
    channel.
  - `GET /v3/users/<slug>/contents?sort=created_at_desc&type=Image` follows
    a curator rather than a channel. It works unauthenticated.
  - Search is premium-only.
- **Following instead of listing:** with a token, `GET /v3/me/feed` is your
  Are.na follow feed (channels and people you follow). It's newest-first,
  with cursor paging. It returns 401 without auth. Following things on
  Are.na then becomes the way to manage this source, with no channel list
  kept in re-collect.
- **Use a personal access token, not guest access.**
  - Guest limits are 30 requests a minute **per IP**, and Convex actions
    share outbound IPs with other Convex apps.
  - A free token gives 120 a minute per account.
  - 50 channels polled 4×/day is ~200 requests a day, far under either
    limit.
- **Send a descriptive User-Agent.** A browser UA gets a 403.
- **Multi-user:** each user can connect their own Are.na account via OAuth
  (PKCE, `read` scope). They get their own follow feed and their own rate
  budget, and nothing is shared between users.

### Tested: sources with data in the page or an open API (2026-11-05)

Extraction scripts were written and run for each of these. Every one returns
its own image or video URL, so no screenshots are needed. All media below
loaded with no Referer and with a foreign Referer, except where noted.

- Recent and Seesaw were tested by hand; their recipes are in §1b.
- About 80 more sites were probed by two agents. The full notes, with two
  example records per site, are `discovery-notes/embedded-A.md` (website
  galleries) and `discovery-notes/embedded-B.md` (everything else).

**Recent (formerly Godly).**

- **The API:** `api.recent.design/rpc/items/list` is what the site's own
  "load more" calls. It answers a plain POST with no auth and no bot wall,
  and pages with `nextCursor`.
- **Feeds that matter:**
  - `{feed:"x", format:"tweet"}`, the homepage: a hand-curated stream of
    design posts from X, ~4/day.
  - `{feed:"launch-videos", format:"tweet", category:"launch-videos"}`:
    ~1.5/day.
- **What each item gives:** the X post URL, the creator, typed tags (style,
  interaction, colour) and MP4s up to 4K with WebP posters.
- **The websites feed has had nothing new since 2026-07-04,** so it's no
  longer a useful website source.

**Seesaw.**

- Parse the Next.js payload on the homepage: 893 sites, about 5 new per week.
- Category and font names resolve from lookup tables in the same payload.
- Media are built from each site's `imgId` on Cloudinary. The poster is
  `video/upload/w_1440/<imgId>.jpg` and the loop is
  `video/upload/w_640,du_3/q_auto:eco/<imgId>.mp4`.

**Website galleries (`embedded-A.md`):**

| Site                                                                             | Data                                                   | Media                                                                                                           | Cadence        | Verdict                      |
| -------------------------------------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- | -------------- | ---------------------------- |
| curated.design                                                                   | Server-rendered cards; dates in sitemap                | 1600×900 WebP + MP4; 3840px PNG in sitemap. Keep the full signed URL (stripping the ~10-year token gives a 403) | ~15–40/month   | ★                            |
| inspo.page (Details.so)                                                          | Inline JSON blob                                       | 1920px MP4 section clips tagged Hero/Footer etc. Foreign Referer gets 403: use `referrerpolicy="no-referrer"`   | several/week   | ★ (sections)                 |
| siiimple                                                                         | WordPress REST + homepage links                        | 1500×960 JPG                                                                                                    | daily          | ✓                            |
| deadsimplesites                                                                  | All 561 cards in one page                              | 2224×3180 tall JPG                                                                                              | ~3/week        | ✓                            |
| bestwebsite.gallery                                                              | Server-rendered cards with dates                       | 1280×800 PNG                                                                                                    | 1–2/week       | ✓                            |
| admiretheweb                                                                     | Nuxt payload                                           | 2000×1250 JPG                                                                                                   | weekly batches | ✓                            |
| thefwa.com                                                                       | Open JSON `/api/winners` (robots.txt disallows `/api`) | 1600×1200 JPEG                                                                                                  | 2–3/week       | ✓                            |
| Framer gallery                                                                   | Next.js payload                                        | 1600×1200 images; video only as HLS streams (no MP4)                                                            | many/day       | ✓ (noisy)                    |
| godly.design                                                                     | Server-rendered feed                                   | X-post MP4s + site thumbnails                                                                                   | fresh          | ✓ (overlaps Recent's X feed) |
| viewportui.com                                                                   | Astro cards + RSS                                      | MP4 up to 2538px, from X                                                                                        | batches        | ✓                            |
| saaspo, saasframe                                                                | Cloudflare challenge                                   | —                                                                                                               | —              | ✗                            |
| httpster, bentogrids, supahero, navbar.gallery, brutalistwebsites, lookup.design | Dead or stale                                          | —                                                                                                               | —              | ✗                            |

**Other visual inspiration (`embedded-B.md`):**

| Site                                                                            | Content                      | Data                                                                    | Media                                      | Cadence     | Verdict           |
| ------------------------------------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------- | ------------------------------------------ | ----------- | ----------------- |
| Fonts In Use                                                                    | Type in use                  | `main.rss` (full HTML with images); robots asks for a 10 s crawl delay  | `@2x` 1399px                               | ~8–10/day   | ★                 |
| typographicposters.com                                                          | Posters                      | Open JSON `/api/tg/posters-recent` (not date-sorted: scan 2–3 pages)    | 1132×1600 JPG, MP4                         | ~3/week     | ★                 |
| The Brand Identity                                                              | Identity projects            | Open GraphQL `POST /api`                                                | 2000px JPG / MP4 + poster, dominant colour | ~8–10/week  | ★                 |
| It's Nice That                                                                  | Graphic design, illustration | `<script id="props">` JSON on the homepage (robots disallows its feeds) | `?class=w1440`                             | ~15–20/week | ★                 |
| BP&O                                                                            | Branding, packaging          | WordPress REST                                                          | Full-size uploads, inline MP4              | ~3/week     | ★                 |
| logosystem.co                                                                   | Logos                        | Next.js payload, all 1,383 logos; no dates, so diff by ID               | 1200² JPG, MP4                             | —           | ✓ (niche)         |
| showreel.design                                                                 | Motion reels                 | Open JSON `/api/videos.json`                                            | MP4 loop; poster is served as `video/mp4`  | ~3–8/week   | ✓ (motion)        |
| Mindsparkle, Brand New, abduzeedo, The Dieline, Creative Boom, Inspiration Grid | Branding / editorial         | RSS or WordPress REST                                                   | 1400–2000px                                | daily       | ✓ (newsy, filter) |
| 60fps.design, Rive, three.js showcase, CodePen Spark                            | Motion / interaction / WebGL | Framer HTML, open JSON, Discourse JSON, RSS                             | MP4 / images                               | weekly      | ✓                 |
| Codrops, codepen.io/picks, Shadertoy, Packaging of the World                    | —                            | Bot-walled                                                              | —                                          | —           | ✗                 |
| typewolf, logobook, Grain Edit, TypeRoom                                        | —                            | Dead                                                                    | —                                          | —           | ✗                 |

**Implementation notes from testing:**

- **About four parser shapes cover almost everything:** RSS/Atom, WordPress
  REST (`/wp-json/wp/v2/posts?_embed`), a JSON blob in the page (Next.js
  `self.__next_f`, Nuxt `__NUXT_DATA__`, `<script type="application/json">`),
  and a handful of one-off JSON or GraphQL endpoints (Recent, The Brand
  Identity, typographicposters, showreel). Each source gets a small adapter
  that maps to the same candidate shape.
- **Pull JSON out of the page; never run the site's script.** Recent's page
  payload is executable JS, which is why its API is the right route. Next.js
  and Nuxt payloads can be read as plain JSON.
- **Some sources have no dates.** For logosystem, Astro and cta.gallery, diff
  by ID and treat unseen IDs as new. Dates can sometimes be recovered from
  Mongo ObjectIds, cuid/UUIDv7 IDs, X status IDs or timestamps in file names.
- **Many of these sources are video-first.** Show the poster image in the
  grid and play the MP4 loop on hover or open. Video isn't a library item
  type yet.
- **Media quirks:**
  - Two sources send the wrong content type (showreel posters, Rive).
  - Two return 403 on a foreign Referer (inspo.page, webdesign-inspiration),
    so render media with `referrerpolicy="no-referrer"`.
  - Never store a redirect target (hoverstat.es Vimeo links expire).
- **Send a normal browser user agent everywhere.** A few sites react to
  `curl`.
- **Datacenter IPs:** everything was tested from a home IP. The website
  agent also re-ran its sites with Node `fetch`. cssdesignawards started
  timing out after a few fetches, so per-source rate limits matter.

## 1b. Adapter recipes (verified by hand)

Exact calls that worked, so they don't have to be rediscovered. Send a normal
UA (Chrome-like for galleries, descriptive for Are.na).

**Recent (`api.recent.design`, oRPC):**

```
POST https://api.recent.design/rpc/items/list
Content-Type: application/json
{"json":{"feed":"x","format":"tweet","sort":"recent","limit":40}}
→ {"json":{"items":[…],"nextCursor":"1793756650387:4ldtkhb"}}
next page: add "cursor":"<nextCursor>"
```

- **Other feeds:**
  - `{"feed":"launch-videos","format":"tweet","category":"launch-videos"}`
  - `{"feed":"websites","format":"site"}` (stale since 2026-07-04)
  - `app-icons/app_icon`, `og-images/og`,
    `app-store-screenshots/app_screenshot` (stale)
- **Item fields:**
  - `id`, `title`, `category.name`, `description`, `tags[]` (`{context,
name}`, where context is style, interaction, color or framework), and
    `staffPickAt`.
  - `source.url` is the X post or site URL; `creator` has `{name, handle,
url, avatar}`.
  - `publishedAt` / `createdAt` are in ms.
  - `media[]` / `cover` have `{mediaType, url, mediaWidth, mediaHeight,
poster{url, renditions}, renditions[], colours[{hex, proportion}]}`.
- **Media:** `cdn.recent.design`, hotlinkable, `immutable` year-long cache.
  Posters are `…/poster/{360,640,960,1200}.webp`; MP4s run up to 4K, so pick
  a rendition.
- **The page itself** (`$tsr` script, TanStack Start/seroval) is executable
  JS. Use the API, not the page.

**Seesaw (`www.seesaw.website`, Next.js RSC, Airtable IDs):**

1. GET the homepage (~3.7 MB). Join every
   `self.__next_f.push([1,"…"])` string, JSON-unescaping each, into one
   payload.
2. `{"sites":[…]}` holds 893 records: `{id, title, description, slug, link,
publishedDate (YYYY-MM-DD), category[ids], fonts[ids], imgId, ogImg}`. The
   array isn't sorted, so sort by `publishedDate`.
3. Resolve names: scan every `"categories":[{…}]` / `"category":[{…}]` array
   for `{id, name}` (267 categories), and every `"fonts":[{…}]` array for
   font names, skipping `"$undefined"`.
4. Media (Cloudinary, hotlinkable):
   - Poster: `https://res.cloudinary.com/seesawsite/video/upload/w_1440/<imgId>.jpg`
     (1440×809).
   - Loop: `…/video/upload/w_640,du_3/q_auto:eco/<imgId>.mp4`.
   - `ogImg` is a ready-made social image.
5. Strip `?ref=` from `link`.

**Are.na:** recipe in §1 ("Are.na channels as a source").

**MaxiBestOf:**

- The public API `GET https://maxibestof.one/api/websites?page=1` (32 per
  page, `count.pages`) is documented but returns a Cloudflare challenge to
  servers.
- The MCP endpoint `https://maxibestof.one/mcp-server` (Streamable HTTP)
  returns a clean 401 to servers, so it's reachable.
- Auth is OAuth 2.0 with PKCE: register at `POST /api/mcp/register`,
  authorize at `/api/mcp/authorize` (scope `mcp:read`, resource
  `https://maxibestof.one/mcp-server`), then exchange at `POST /api/mcp/token`
  and use refresh tokens.
- It needs Pro. The tool list (and whether there's a "newest" listing) is
  untested without a login.

**Others** (details in `discovery-notes/embedded-A.md` / `embedded-B.md`):

- typographicposters: `GET /api/tg/posters-recent?page=0&itemsPerPage=N`,
  not date-sorted; the date is in the Mongo ObjectId (`int(id[:8],16)`).
- The Brand Identity: Craft GraphQL at `POST /api`.
- It's Nice That: `<script id="props" type="application/json">`.
- showreel.design: `GET /api/videos.json`.
- FWA: `GET /api/winners`.
- WordPress sites: `/wp-json/wp/v2/posts?_embed`.

## 2. Recommended v1 sources

All readable with a plain fetch, all shipping their own image or video, so
nothing is screenshotted.

**Websites:**

1. **Awwwards** — Sites of the Day RSS, plus the nominee JSON if you want
   more volume.
2. **Siteinspire** — RSS.
3. **One Page Love** — RSS.
4. **Seesaw** — the catalog in the page. Use the still image.
5. **curated.design** — the server-rendered cards.

**Motion and UI from X, with no X API:**

6. **Recent's X feed** — through its JSON API. It's a free, hand-curated
   substitute for paid X discovery.

**Hand-curated, closest to your taste:**

7. **Are.na** — 5–20 channels you pick, plus the snowball from blocks you've
   already saved.

**If you want more than websites,** add one or two of: Fonts In Use, The
Brand Identity, It's Nice That, typographicposters.com. They're all ★ above,
with zero overlap with the web galleries.

**Easy swaps:** minimal.gallery (RSS, 1/day, hotlink only), Behance featured
RSS, inspo.page (section clips), Pinterest board RSS.

**Expected intake:**

- **Website sources:** about 25–40 new candidates a day before dedupe, mostly
  Awwwards nominees.
- **Recent's X feed:** about 4–6 a day.
- **Are.na:** whatever your channels produce, probably 20–100 a day.
- **Total:** about 50–150 a day, which comfortably fills a daily feed.

**Legal posture.** For one person polling a public feed once or twice a day,
the risk is low. Two of the RSS feeds (Awwwards, One Page Love) are
disallowed in robots.txt, Recent is read through an undocumented API, and
Seesaw is read by parsing its page. Recent's robots.txt also says
`ai-train=no`. Ranking your own feed isn't training, but it's worth knowing.
If re-collect becomes a product, revisit all of these: ask the sites, or link
out instead of mirroring.

## 3. X / Twitter

| Option                                                                     | Cost/mo (≈50–200 posts/day)                                                                                                                                                                                                   | Gives                                                                                                                                                                   | Verdict                                                                                               |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **Official X API, pay-per-use** (the default since Feb 2026; no free tier) | Your own bookmarks and likes: **$1–3** ($0.001/read). Discovery via list or user timelines and recent search: **$10–40** ($0.005/post; billed once per post per 24 h; 3M reads/mo cap). New accounts get up to $70 in credits | Full post data incl. image URLs (`media.fields`). Bookmarks need an OAuth2 user token with `bookmark.read`. Likes are private since 2024, so you can only read your own | **Recommended**                                                                                       |
| **xAI Grok `x_search`**                                                    | ~$15–50 ($5 per 1k posts fetched since 2026-09-21, plus tokens; quoted posts and threads count)                                                                                                                               | A text answer plus cited post URLs; **no image URLs**, so every post needs a second lookup. Can filter by up to 20 handles and a date range. Results vary run to run    | ✗ as the feed. Maybe later as a ~$1/mo weekly "suggest new design accounts" job                       |
| **Your own likes/bookmarks without the API**                               | $0                                                                                                                                                                                                                            | X archive export (likes only, manual); a bookmarklet or extension scraping your bookmarks page (breaks when X changes its pages)                                        | Fallback only                                                                                         |
| **Scraper APIs** (twitterapi.io ~$0.15/1k, SocialData, Apify)              | <$5                                                                                                                                                                                                                           | Search, user and list posts with images                                                                                                                                 | ✗ — breaks X's terms; never give them your login cookie                                               |
| **Nitter / RSSHub / RSS-Bridge**                                           | $0                                                                                                                                                                                                                            | RSS, when it works                                                                                                                                                      | ✗ — X sent Nitter a cease-and-desist (2026-08); ~3 of 12 instances alive; RSSHub needs your X cookies |
| **Bluesky**                                                                | $0                                                                                                                                                                                                                            | Author, list and custom feeds work without login, with image URLs on `cdn.bsky.app`. Search needs auth past page 1; profile RSS has no images                           | ✓ free extra, but the design scene is small (the biggest "Graphic Design" feed gets ~30 posts/day)    |
| Mastodon `#webdesign`, Threads                                             | $0                                                                                                                                                                                                                            | Low volume; Threads search needs Meta app review                                                                                                                        | ✗                                                                                                     |

**Recommendation:**

- **v1:** a daily cron that reads your **X bookmarks** through the official
  API (~$1–3/mo) and stops at the last post it has already seen.
  - This is ingestion, not discovery: you already chose those posts. They can
    go straight into the library, or into the feed pre-kept.
  - Either way, they're the strongest taste signal you'll get, and
    "bookmark it on X" becomes a capture method.
- **Free discovery from X, in v1:** Recent's X feed. It's a hand-curated
  stream of design posts from X (~4/day), with the post URL, creator, tags
  and MP4s already hosted on their CDN. godly.design and viewportui.com are
  similar. These cover most of what paid X discovery would.
- **v1.5, only if that's not enough:** discovery from an X list of 20–30
  design accounts.
  - Images only, no retweets, scored like any other source.
  - Set a hard spend cap in the X console.
- **Skip Grok.** It's a search assistant, not a feed API.

## 4. Fetching architecture

### What runs where

- **Convex actions, plain `fetch`.** Use them for all v1 sources: RSS/Atom
  parsing, JSON endpoints, the embedded page data on Recent and Seesaw, one
  extra fetch per item for the original URL, the Are.na API, the X API and
  embedding calls.
  - Default-runtime actions get 30 min and up to 1,000 concurrent fetches,
    far more than needed.
  - Parse XML with a small dependency like `fast-xml-parser`. Use the Node
    runtime only if a parser needs it.
- **Browser Rendering worker.** Only use it when you keep a candidate that
  has no usable image, or for walled sources if you choose to try them.
  - **The Workers Free plan (what the app is on, per the comment in
    `screenshots.ts`)** gives 10 browser-minutes a day, 3 concurrent
    browsers and 1 new browser per 20 s. At ~15 s per capture that's
    **~40 screenshots/day**, shared with normal saves.
  - **Workers Paid ($5/mo)** includes 10 h/month, then $0.09/h. That's about
    $0.27/mo for 100 screenshots/day and about $4.70/mo for 500/day.
  - There are also REST quick actions (`/screenshot`, `/content`, `/json`,
    `/crawl`). `/crawl` respects robots.txt and is free while in beta when
    `render:false`.
- **The worker's existing og mode** already tries a plain fetch for og:image
  before launching a browser. Feed items without an image (Sidebar, Product
  Hunt) can use it for free.

### Polling

- **One cron, `discovery.pollDue`, running hourly.** It picks the sources
  whose `nextPollAt` has passed and schedules one action per source, using
  the existing Workpool pattern with a small `discoveryPool`.
- **Per-source interval:**
  - Every 6 h for daily galleries (Awwwards, Recent).
  - Every 12–24 h for weekly ones (Seesaw, One Page Love, Siteinspire) and
    for Are.na channels.
  - Daily for X.
- **Use conditional GETs.** Send `ETag` / `If-Modified-Since` and stop
  paging at the last item already seen, which is stored as a per-source
  cursor.
- **Be polite with per-item detail fetches.** Some items need an extra
  request for the original URL (Awwwards, One Page Love, minimal.gallery).
  Run those serially through the workpool with a delay.
- **Track source health.** Record `lastError` and `consecutiveFailures`, and
  show broken sources in a settings view. Embedded-data parsers will break
  silently when a site redesigns.

### RSS caveats

- **A feed is a short window, not an archive.** Probed sizes: minimal.gallery
  10 items, Pinterest ~25, Awwwards 30, Behance 36, Land-book 50. If polling
  stops for longer than the window, the missed items are gone. There's no
  backfill through RSS; use the sitemap or the WordPress REST API once if you
  want history.
- **Feeds are thin.** Many leave out the original site URL (Awwwards,
  minimal.gallery, One Page Love, Land-book, Lapa), so each item costs one
  extra page fetch. Some have small images (Behance 808px, Land-book's
  signed 600px), and some have none (Sidebar, Product Hunt, hoverstat.es).
  Several have no tags.
- **The format varies by feed.**
  - Feeds come as RSS 2.0, Atom or RDF.
  - The image can be in `<enclosure>`, `media:content`, or an `<img>` inside
    the description HTML.
  - Some feeds are served with the wrong content type (Awwwards sends
    `text/html`), and dates are missing on some (Typewolf).
  - Use a tolerant parser plus an image-extraction fallback chain, ending
    with the page's og:image.
- **Don't trust `guid` for dedupe.** It's missing on some feeds and changes
  on others when a post is edited. Edited posts also come back with a new
  date. Dedupe on the normalized URL.
- **Dead feeds still return 200.** A dead feed often keeps serving its last
  items instead of erroring (Typewolf hasn't changed since Dec 2025, Grafik
  since May 2025). Feeds also move (It's Nice That's own `/rss` is a 404,
  but its FeedBurner feed works). So health checks need a "nothing new in N
  days" alert as well as HTTP errors.
- **Access rules:**
  - Behance returns 400 to a curl user agent, so send a browser-like one.
  - Siteinspire's other feed paths and Reddit's RSS return 429 when polled
    quickly.
  - Awwwards' and One Page Love's robots.txt disallow their feeds.
  - All of this was probed from a home IP; Convex's datacenter IPs may be
    treated differently.
- **Conditional GETs are hit or miss.** Many feeds don't send `ETag` or
  `Last-Modified`, so expect a full download every poll. They're small,
  but it's a reason not to poll more often than hourly.
- **You get the site's own selection.** "Featured" or "latest" is all a feed
  offers: no popular or top view, and no category filter (Behance ignores
  `?field=`). Some sites publish in batches (Dark Mode Design every two
  weeks), so the feed arrives in bursts.
- **Image URLs can expire or be locked.** Signed or Referer-checked CDNs
  (Land-book's resizer, Pinterest sizes, Lapa) can break hotlinks later.
  Copy into R2 on keep. If a v1 source turns out like this, show its
  thumbnails through a proxy.
- **A feed is permission to read, not to republish.** Showing items to
  yourself is fine. Re-serving full images to other users in a multi-user
  product is a different question.

### Dedupe

- `normalizeUrl(url)`:
  - Lowercase the host and strip `www.`.
  - Drop the hash, `utm_*`, `ref`, `via` and `source` params, and the
    trailing slash.
  - Website galleries mostly feature homepages, so the key is effectively
    the host plus path.
- **Candidate ↔ candidate.** Insert-or-merge on `by_normUrl`. A second
  gallery featuring the same site appends to the candidate's `sources` list
  instead of creating a new row. Being featured by several galleries is
  itself a quality signal.
- **Candidate ↔ library.** Skip candidates whose `normUrl` is already in
  `items`.
  - This needs a stored `normUrl` field on items with an index.
  - That's the same field the TODO's "duplicate detection on paste" needs, so
    build it once.
- **Image sources** (Are.na, Behance, X) dedupe by source permalink. Embedding
  near-duplicates (cosine > ~0.97) can catch the same image reposted
  elsewhere.

### Tables

Keep candidates out of `items`. They're high-volume, short-lived and
unreviewed, and every `items` query and count would otherwise have to filter
them out.

```
discoverySources
  kind: 'rss' | 'arena' | 'recent' | 'seesaw' | 'x' | ...
  name, config (feed URL / channel slug / handle list), enabled
  pollIntervalHours, nextPollAt, cursor (last guid/date/etag)
  lastPolledAt, lastError, consecutiveFailures
  .index('by_nextPollAt')

candidates
  normUrl                      // dedupe key (or the source permalink for image sources)
  url                          // original site URL / source permalink
  kind: 'site' | 'image'
  title, description, sourceTags[]
  imageUrl, imageWidth, imageHeight, videoUrl?   // remote, hotlinked — not in R2
  sources: [{ sourceId, permalink, featuredAt }]
  status: 'pending' | 'ready' | 'seen' | 'kept' | 'skipped' | 'expired' | 'failed'
  score?, neighborItemIds?[]   // top kNN library items — doubles as the "why"
  itemId?                      // set on keep
  firstSeenAt
  .index('by_normUrl', ['normUrl'])
  .index('by_status_score', ['status', 'score'])

itemEmbeddings      { itemId, embedding: float64[1024], model }   .vectorIndex(dims 1024)
candidateEmbeddings { candidateId, embedding, model }
```

**Embeddings get their own tables, never fields on `items` or `candidates`.**
A 1024-dim vector is about 8 KB per document. Putting it on items would bloat
every reactive list query, and Convex reads whole documents.

### Pipeline

```
cron (hourly) → pollSource action (per due source)
  → parse entries → normalize → upsert candidates (merge sources on normUrl,
    drop if already in items) as status 'pending'
  → schedule enrich (workpool): resolve original URL if needed,
    validate image (size ≥ 400px like the og path)
  → embed image (model per embeddings-research.md, from imageUrl) → candidateEmbeddings
  → score: ctx.vectorSearch(itemEmbeddings, k=16) → score + neighborItemIds
  → status 'ready'

Discover page: query by_status_score ('ready', desc) + explore slots
  → Keep  → create item (pick collection) via the normal add path;
            copy the candidate image into R2 (new key, e.g. discover/{itemId}-{ts}.ext)
            or enqueue a screenshot; reuse the embedding (copy row to itemEmbeddings);
            existing tagging runs as usual; candidate.status = 'kept', itemId
  → Skip  → status 'skipped' (kept as a negative signal)
cron (daily) → expire 'ready'/'seen' candidates older than ~14 days; delete expired
               candidates + their embeddings after ~60 days (keep skipped longer for the penalty)
```

**Hotlink candidate images, and only copy into R2 on keep.** This avoids
storing thousands of unkept images, and minimal.gallery's terms forbid bulk
downloads anyway.

**Hotlinking risks:**

- Some CDNs block hotlinking or need a Referer (Lapa, Unbound by default).
  Those sources are already out of v1.
- If a v1 source starts blocking, a thumbnail proxy route on the app worker
  can fix it.

### Multi-user note

Multi-user accounts have since shipped: items, collections and
viewPreferences carry `userId`, and public functions use `userQuery` /
`userMutation` (see `AGENTS.md`, `reference/multi-user.md`). So design the
candidate pool as **global** from the start:

- `candidates` and `candidateEmbeddings` are shared, and each source is
  polled once.
- Per-user state goes in a separate `candidateStates` table (`userId`,
  `candidateId`, `status`, `score`).

- Per-user sources (an Are.na follow feed, X bookmarks) produce candidates
  that only that user sees.
- Taste vectors are per user.

## 5. Taste ranking

### v1: image-embedding kNN

1. **Backfill.** Embed every library item's image once, with a migration.
   Items with no image (text items) are left out.
2. **Score each candidate.** Take the mean cosine similarity of its top-k
   (k≈10) nearest library items, using Convex vector search from an action.
   - kNN beats a single centroid because the library spans several separate
     aesthetics, and averaging them yields a muddy "average taste".
   - The neighbours double as the explanation: "similar to X, Y, Z" on the
     card.
3. **Feedback.**
   - **Keep:** the item joins the library, and therefore the index.
   - **Skip:** subtract λ × the max similarity to the last ~200 skipped
     candidates. Load their vectors in the action; no second index needed.
   - **Recency:** optionally weight neighbours by `dateAdded`, so recent
     taste counts more.
4. **Mix the feed.**
   - About 80% exploit: the top scores.
   - About 20% explore: random picks from the middle band, so the feed
     doesn't collapse into one look and still shows you new things.
   - A cap per source, say ≤40% of a page, so Behance or Are.na can't flood
     it.
5. **Freshness.** Expire candidates after ~14 days instead of decaying their
   scores. It's simpler and has the same effect.

A cheaper alternative with no embeddings: tag every candidate with the
existing tagger and score it by TF-IDF overlap with library `styles` and
`aiTags`. It's explainable ("brutalist, monospace"), but tags are sparse,
synonym-prone and weak on pure visual similarity. Embeddings cost about the
same as tagging, so there's no real reason to skip them. Tags can still be
added to the explanation later.

### Embedding options (per 1k images at ~512²)

> **Superseded:** `reference/embeddings-research.md` (2026-11-05) benchmarked
> these models on the real library and picks EmbeddingGemma 2 (fallback:
> Gemini Embedding 2) over Voyage. The table below is kept as a price
> snapshot.

| Model                                | Shared text+image space | Dims                    | $/1k images         | Notes                                                                                                                                      |
| ------------------------------------ | ----------------------- | ----------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Voyage `voyage-multimodal-3.5`**   | yes                     | 256–2048 (1024 default) | $0.16               | **150B free pixels per account (~570k images)**, but only when called directly, not via OpenRouter. Strong on screenshots. **Recommended** |
| Gemini Embedding 2                   | yes                     | 128–3072                | $0.12 ($0.06 batch) | Free tier, but under its data-use terms                                                                                                    |
| Jina `jina-embeddings-v5-omni-small` | yes                     | 1024                    | ~$0.02              | Cheapest paid; free key is non-commercial                                                                                                  |
| Cohere embed v5                      | yes                     | 256–2048                | ~$0.13 (inferred)   | —                                                                                                                                          |
| Amazon Titan Multimodal G1           | yes                     | 1024                    | $0.06               | Older (2023), weaker                                                                                                                       |
| OpenAI, Cloudflare Workers AI        | **no image embeddings** | —                       | —                   | —                                                                                                                                          |

The shared text-image space matters for two things: a "describe what you
want" prompt at cold start, and mixing text and image signals later.

### Convex vector search

- **Limits:**
  - 2–4096 dims, one vector field per index.
  - Up to 256 results per query.
  - Equality filters only.
  - **Actions only.**
  - Each search is billed at the full index size.
- **Size:** 10k × 1024-dim vectors is about 40–80 MB, counted both as stored
  documents and in the vector index. That fits the free plan's 0.5 GB caps.
  50k is borderline: use 512 dims, or the pay-as-you-go plan for pennies.
- **Cost:** kNN for 150 candidates a day against a 5k-item index is
  roughly 1k query-GB a month, inside the free quota.

### Cold start

- **For you, there's only a mild one.** The library exists, but it's only
  ~93 items, so the backfill gives a real but thin signal. Lean on keep/skip
  feedback early, and use more exploration at first.
- **For a future new user:**
  - Show 30 diverse candidates and ask them to pick 5–10.
  - Or use a text prompt ("dark, editorial, swiss type") embedded in the same
    space.
  - Until a library exists, rank by cross-gallery feature count, which
    measures popularity rather than taste.

### Cost at v1 volume (~150 candidates/day)

| Item                                                                           | Monthly                                                                      |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Embeddings (library backfill + 4.5k candidates/mo; see embeddings-research.md) | well under $1                                                                |
| Tagging candidates with the current model (optional; only kept items need it)  | ~$1–2                                                                        |
| Browser Rendering                                                              | $0 if screenshots are only taken on keep and stay ≤ ~40/day on the free plan |
| Convex                                                                         | Within the current plan                                                      |
| X bookmarks / X discovery                                                      | $1–3 / $10–40                                                                |

Even 1,000 candidates a day would cost about $5/mo to embed after the free
allowance runs out. The limit on volume is how much you can review, not
cost: a feed of 30–60 good items a day is plenty.

## 6. Open questions

Still open:

1. **Scope.** De facto broad now: websites plus branding, type, posters,
   motion and Are.na images. Is that right, or should it narrow?
2. **Taste ranking.** When does the feed move from round-robin to ranking
   (kNN to the library, §5)? Volume is ~2,500 candidates and growing.
3. **Embeddings.** Does "no embedding" rule out taste-ranking vectors for
   feed items, or only re-hosting media?
4. **X.** Is Recent's curated X feed enough, plus optional bookmark
   ingestion (~$1–3/mo)? Paid X discovery ($10–40/mo) only if not.
5. **Gray areas.** Are you OK polling the two robots-disallowed feeds
   (Awwwards, One Page Love), Recent's undocumented API and Seesaw's page data
   for personal use?
6. **MaxiBestOf.** Pay for Pro and use the MCP, or email the owner about the
   blocked public API first?
7. **Feed shape.** Endless for now. A daily batch ("today's 30") would cap
   the reviewing effort.
8. **Taste signal.** With skip gone (browse, not triage), adds are the only
   signal. If ranking comes, does it need an explicit "less like this"?
9. **Video as an item type** (see Decisions).
10. **Cloudflare Workers Paid ($5/mo).** It removes the ~40-screenshots-a-day
    ceiling. That's only needed if walled or imageless sources are wanted
    later.

To do (not decisions):

- **Set `ARENA_TOKEN`** (an Are.na personal access token) on dev and prod.
  Without it, 11 channels polled as a guest use a good share of the
  30-a-minute per-IP limit.
- **Before production,** deploy, then run
  `npx convex run items:rebuildSearchText --prod` to backfill `normUrl`.
- **Prune sources again** after using the feed for a while. The first by-eye
  pass (2026-11-14) went on 12 images per source.
- **Filter blank screenshots.** Are.na's screenshots of dark sites are
  sometimes all black or all white; use a luminance or blurhash check.
- **Expire untouched candidates** after 30–60 days.
- **Check sources from Convex's IPs.** Every source works there so far, but
  the research was done from a home IP.

Resolved:

- **Multi-user:** shipped, with a global pool and per-user state.
- **Bulk Are.na:** out for now.
- **Image on keep:** the source's own image, copied to R2.
- **Are.na seeds:** 20 scouted channels in code.
- **Pool model:** curated, set in code.
- **Keep target:** an "add to" list in the card's modal.
