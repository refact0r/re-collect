# Discovery feed from X/Twitter (and substitutes): options, Nov 2026

Researched 2026-11-04. "Verified" means I read it on an official page or tested it live today. Anything else is marked as unverified or secondhand, with its age.

## TL;DR

- **X API is now pay-per-use** (default since Feb 2026). It has no subscription and no free tier for new developers. Post reads cost **$0.005 each**. Reads of **your own** likes and bookmarks cost **$0.001 each**. The legacy Basic and Pro plans have been retired.
- **Your own bookmarks and likes:** the official API is the clean answer and costs pennies a month. Likes have been private since June 2024, so only your own likes are readable.
- **Grok `x_search`** costs **$5 per 1k posts fetched**, plus tokens. It returns post URLs as citations but **no media URLs**. Output varies between runs, so it isn't a good feed source. It works better as a weekly "find me new accounts" scout.
- **Nitter and RSS bridges are effectively dead for X.** X sent Nitter a cease and desist in Aug 2026.
- **Third-party scrapers are 20–30× cheaper** than the official API (about $0.15–0.40 per 1k tweets) but carry vendor and ToS risk.
- **Bluesky** works for free with no auth for author feeds, lists and custom feeds (tested today). Its design community exists but is small.

## Comparison (target: about 50–200 image posts/day, roughly 1.5k–6k posts/month)

| Option                                                                           | Cost/month                                                                                               | What you get                                                                                                                                             | Effort                                               | Risk                                                                                               |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **X API pay-per-use: discovery** (list timeline / user timeline / recent search) | **~$8–30** at 1:1. More realistic is **$25–90** if you over-fetch 3× to filter for images and taste.     | Full post JSON. With `expansions=attachments.media_keys&media.fields=url,preview_image_url,type,width,height` you get direct `pbs.twimg.com` image URLs. | Medium: developer app, credits, polling cron, dedupe | Low (official). Prices "subject to change".                                                        |
| **X API pay-per-use: own bookmarks/likes**                                       | **< $1–3** (owned reads at $0.001/resource)                                                              | Same JSON and media fields. Bookmark folders are supported.                                                                                              | Medium: OAuth2 PKCE user token plus refresh handling | Low                                                                                                |
| **xAI Grok `x_search`**                                                          | **~$15–50** (a daily run fetching 100–300 posts at $5/1k, plus tokens). Image understanding costs extra. | An LLM answer plus `citations` (x.com/i/status/... URLs). **No image URLs**, so you hydrate them separately. Filters: up to 20 handles, date range.      | Low to start, high to make reliable                  | Medium: output varies between runs, counts aren't deduped, the model picks how many posts to fetch |
| **Third-party scraper APIs** (twitterapi.io, SocialData, Apify)                  | **~$0.25–5**                                                                                             | Tweets with media (search, user, list). There's no safe way to get _your_ bookmarks without handing over cookies.                                        | Low                                                  | High: scraping violates X ToS, and X is actively pursuing scrapers                                 |
| **X data archive (manual)**                                                      | $0                                                                                                       | Likes as tweet IDs and text. Bookmarks are **not included** (secondhand).                                                                                | Manual, slow (archive request)                       | None                                                                                               |
| **Browser extension / userscript** (scrape your bookmarks page)                  | $0                                                                                                       | Whatever the logged-in DOM shows, including images                                                                                                       | Medium (you build it)                                | Low for personal use, but breaks on X UI changes                                                   |
| **Nitter / RSSHub / RSS-Bridge / rss.app**                                       | $0–~$10                                                                                                  | RSS of user timelines when it works                                                                                                                      | Medium (self-host plus burner X account tokens)      | Very high: mostly dead                                                                             |
| **Bluesky public AppView**                                                       | **$0**                                                                                                   | `getAuthorFeed` (with `filter=posts_with_media`), `getListFeed`, `getFeed` (custom feeds), and image URLs on `cdn.bsky.app`                              | Low                                                  | Low. Less design content than X.                                                                   |
| **Mastodon hashtag timelines**                                                   | $0                                                                                                       | `/api/v1/timelines/tag/:tag?only_media=true` on mastodon.social (tested)                                                                                 | Low                                                  | Low. Low volume (about 10 media posts/day for #webdesign).                                         |
| **Threads API**                                                                  | $0                                                                                                       | Keyword search needs the `threads_keyword_search` permission (app review)                                                                                | Medium-high                                          | Medium. Limits unverified.                                                                         |

---

## 1. Official X API (docs.x.com)

**Pricing model (verified on the official page, no date shown; fetched today):** https://docs.x.com/x-api/getting-started/pricing

- Pay-per-use credits, with no subscription or minimum. Requests are blocked when the balance goes negative. You can set auto-recharge and spending limits.
- Reads are billed **per resource returned**:
  - Posts, Lists, Spaces, Communities: **$0.005**
  - Users, Following/Followers: **$0.010**
  - Likes, Mutes, Blocks: **$0.001**
- **Owned Reads:** your own posts, mentions, **likes, bookmarks**, followers and lists, read through your own app, cost **$0.001/resource**.
- **Dedup:** the same resource is billed once per 24h UTC window (a "soft guarantee").
- **Cap:** 3M post reads per billing cycle. Some third-party blogs say 2M, which is outdated. Above the cap you need Enterprise.
- **Unverified:** whether expanded `includes.users` / `includes.media` objects are billed as extra resources. Users at $0.01 would double the cost, so check the console after a test call.
- **Free credits (official page, rule changed 2026-10-13):** $20 after your first credit purchase, plus a match of your first auto-recharge up to $50. They expire after 3 months and are "currently rolling out". https://docs.x.com/x-api/getting-started/free-credits
- **xAI credit kickback** (10–20%) only starts at $200+/cycle, so it's irrelevant here.

**Tiers:**

- **Free:** closed to new developers since Feb 2026. That comes from third-party blogs; the official pricing page simply doesn't mention a free tier.
- **Basic ($200) and Pro ($5,000):** legacy. Basic was auto-migrated to pay-per-use (one blog says 2026-06-01). Pro subscribers move to pay-per-use at the first billing cycle after 2026-09-01 (secondhand, citing devcommunity.x.com/t/273255).
- **Enterprise:** custom pricing.
- Sources: https://opentweet.io/how-to/migrate-x-api-pro-to-pay-per-use, https://opentermsarchive.org/en/memos/x-replaces-its-dollar200-entry-level-api-plan-with-a-pay-per-use-model/

**Endpoints and rate limits (official rate-limits page, no date; the numbers match the old tier tables):** https://docs.x.com/x-api/fundamentals/rate-limits

| Endpoint                        | Limit per 15 min     | Notes                                                                                                                                                            |
| ------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /2/users/:id/tweets`       | 10,000/app, 900/user |                                                                                                                                                                  |
| `GET /2/lists/:id/tweets`       | 900                  |                                                                                                                                                                  |
| `GET /2/tweets/search/recent`   | 450/app, 300/user    | 7-day window, 10–100 results/page, query ≤512 chars. Supports operators like `has:images -is:retweet from:a OR from:b`, which avoids paying for text-only posts. |
| `GET /2/users/:id/liked_tweets` | 75                   | Scopes `tweet.read users.read like.read`, max_results 5–100                                                                                                      |
| `GET /2/users/:id/bookmarks`    | 180/user             | Scopes `tweet.read users.read bookmark.read`, max_results 1–100. Also `/bookmarks/folders` and `/bookmarks/folders/:folder_id`.                                  |

Sources: https://docs.x.com/x-api/users/get-bookmarks, https://docs.x.com/x-api/users/get-liked-posts, https://docs.x.com/x-api/posts/bookmarks/introduction

**Your own bookmarks and likes on the cheapest tier:** yes. You need a user-context OAuth2 PKCE token; add `offline.access` for a refresh token. The **800 most-recent-bookmarks** cap comes from the older developer.x.com docs (pre-2026) and isn't restated on the current reference page. Polling daily from the newest entry and stopping at the last-seen ID avoids hitting it.

**Media:** yes. `expansions=attachments.media_keys` plus `media.fields=url,preview_image_url,variants,width,height,alt_text` returns `includes.media[].url` for photos and `preview_image_url` / `variants` for video.

## 2. xAI / Grok `x_search` (docs.x.ai)

Source: https://docs.x.ai/developers/tools/x-search (pricing in effect since **2026-09-21**). Before that date it was $5/1k calls. Also https://docs.x.ai/developers/pricing and https://docs.x.ai/developers/tools/citations.

- **Price:** $5 per 1k posts fetched and $10 per 1k profiles, plus tokens.
  - Fetched posts include parent posts, quoted posts and whole threads.
  - Counts are **not deduped** across searches.
  - Image and video understanding is billed as image tokens.
  - Cheapest public models: `grok-build-0.1` at $1/$2 per M tokens, and `grok-4.3` / `grok-4.20-*` at $1.25/$2.50.
- **How it works:** the model decides which sub-calls to make (`x_keyword_search`, `x_semantic_search`, `x_user_search`, `x_thread_fetch`). Usage is reported in `usage.server_side_tool_usage_details`. You can cap rounds with `max_turns`.
- **Filters:**
  - `allowed_x_handles` or `excluded_x_handles`, up to 20 and mutually exclusive.
  - `from_date` / `to_date`, `YYYY-MM-DD` only.
  - `enable_image_understanding`.
  - Filters don't apply to thread fetches.
- **Output:**
  - `response.citations` is a list of post URLs. Responses API annotations carry a `url` and a numeric `title`. The SDK has `x_citation.url`.
  - **No structured post objects and no media URLs** are documented.
  - You can prompt Grok to emit JSON, but image URLs it writes itself may be hallucinated. You'd hydrate each cited post ID through the X API ($0.005) or the unofficial `cdn.syndication.twimg.com/tweet-result?id=…&token=…` endpoint. That endpoint worked when I tested it today and returns media, but it is undocumented and may break or be ToS-gray.
- **Verdict:** it isn't a sane primary feed source. It's non-deterministic, gives only partial recall, adds a hydration step, and costs more than the raw API for the same posts.
  - It _is_ useful as a **taste-aware scout**, e.g. "find 10 accounts posting high-quality web/UI design screenshots this week, similar to @a @b". The output feeds the account list the deterministic fetcher uses.
  - "Calling the grok bot" (tagging @grok on X) is not an API. `x_search` is the programmatic equivalent.

## 3. Your own likes and bookmarks without the API

- **Likes are private** since June 2024. You can see your own, others can't. https://www.macrumors.com/2024/05/23/x-twitter-to-make-likes-private/, https://www.dawn.com/news/1839745/x-makes-likes-private-to-protect-users
- **Data archive** (Settings → Your account → Download an archive): includes likes (tweet IDs plus text), but **bookmarks are not included**. That's secondhand, "unchanged as of April 2026" (https://contextbolt.pages.dev/blog/export-twitter-bookmarks/). It's a manual snapshot that takes time to prepare, so it's fine for a one-off backfill (hydrate the IDs afterwards), not for a feed.
- **Extensions and userscripts:** several exist, e.g. "X Bookmark Manager & Exporter" on the Chrome Web Store and the Scrollmark userscript on greasyfork. A small personal bookmarklet or extension that reads the logged-in bookmarks page and POSTs to your Convex HTTP action is free and keeps cookies local. It's brittle against DOM changes. Avoid third-party extensions that upload your data.

## 4. Third-party scraper APIs (unofficial; scrape X)

| Vendor            | Price                                                                            | Source                                                                                      | Notes                                                                                                                         |
| ----------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **twitterapi.io** | **$0.15/1k tweets** (15 credits/tweet), min $0.00015/call, up to $1 free credit  | Verified on https://twitterapi.io/pricing                                                   | Endpoint list (search, list tweets, user tweets) not re-verified today. Their comparison and Nitter blog posts are marketing. |
| **SocialData**    | ~$0.20/1k tweets or users, failed requests not billed                            | **Secondhand.** Their pricing page returned 404. https://socialdata.gitbook.io/docs/pricing |                                                                                                                               |
| **Apify**         | apidojo Tweet Scraper V2 $0.40/1k, Twitter Scraper Lite $0.20/1k, Kaito $0.25/1k | Store listings, no 2026 date seen. https://apify.com/apidojo                                | V2 throttles tiny runs                                                                                                        |

- **Reliability:** generally good, but vendors silently break when X changes internals.
- **Risk:** scraping violates X's ToS, and X is actively enforcing (see Nitter below). For you personally, the risk is mostly **vendor disappearance** rather than account action, because these APIs don't use your account.
- Never give a vendor your `auth_token` cookie to read bookmarks.

## 5. RSS bridges

- **Nitter** (https://en.wikipedia.org/wiki/Nitter):
  - Revived Feb 2025 using registered-account tokens.
  - **2026-08-24:** X Corp sent a cease and desist. The repo was archived 08-25, briefly resurrected on 09-06, and archived again 09-11.
  - xcancel was back on 09-07, then offline again on 09-14. The main nitter.net is offline.
  - Third-party checks in Sep–Oct 2026 found only about 3 of 12 instances serving RSS, unreliably (https://twitterapi.io/blog/nitter-instances, https://www.getxapi.com/alternatives/nitter).
  - **Not viable.**
- **RSSHub** Twitter routes need `TWITTER_AUTH_TOKEN` (logged-in `auth_token` cookies), so you'd self-host and burn an X account. Source is undated mirrored code and DeepWiki (https://deepwiki.com/DIYgod/RSSHub/6-content-source-integrations). Not re-verified for 2026; the official docs URL returned 404.
- **RSS-Bridge and rss.app:** same story, they rely on scraping or cookies. Not verified for 2026. Treat them as fragile.

## 6. Bluesky, Threads, Mastodon

**Bluesky:** I tested these live today against `public.api.bsky.app` and `api.bsky.app`.

- **Works with no auth (200):**
  - `app.bsky.feed.getAuthorFeed?filter=posts_with_media`
  - `getListFeed`
  - `getFeed` (custom feeds)
  - `app.bsky.unspecced.getPopularFeedGenerators?query=design`
- **`searchPosts`:**
  - **403 on `public.api.bsky.app`.**
  - On `api.bsky.app` it returns 200 for page 1, and `since=` works.
  - **With a `cursor` it returns 403** ("Request forbidden by administrative rules").
  - So search is single-page only without auth. Paginate with `since`/`until`, or authenticate with an app password.
  - Matches https://github.com/bluesky-social/bsky-docs/issues/332.
- **Images:** `embed.$type = app.bsky.embed.images#view` gives `images[].fullsize` = `https://cdn.bsky.app/img/feed_fullsize/plain/<did>/<cid>` (verified).
- **RSS:** `bsky.app/profile/<did>/rss` works over GET but is **text only, with no images** (a HEAD request returns 404, oddly).
- **Rate limits:** the docs give no number for the public AppView, just "generous" ("contact us if limited"). 3000/5 min is the PDS limit. https://docs.bsky.app/docs/advanced-guides/rate-limits (docs.bsky.app now redirects to bsky.network).
- **Likes and bookmarks:**
  - `getActorLikes` needs auth as yourself.
  - Bluesky has native bookmarks. `app.bsky.bookmark.getBookmarks` returns 401 `AuthMissing` without auth, so it needs auth (an app password is enough for a single user).
- **Design community:** present but small. Live data:
  - "Graphic Design" feed `at://did:plc:fyal4ypom4hpb35m5wrtkg5l/app.bsky.feed.generator/aaacramas6xd4` has 273 likes and about 30 posts/day, about 40% with images.
  - "Interior design" and "Typography & calligraphy" feeds by `did:plc:dpn35rec72mos7xl77ev7emj` (image-content based).
  - "Best of typography" (Typofonderie).
  - Several tiny "Web Design" feeds (≤25 likes).
  - Better yield comes from following specific designers via a list and `getListFeed`.

**Mastodon:**

- `https://mastodon.social/api/v1/timelines/tag/webdesign?only_media=true` returns 200 unauthenticated. #webdesign had about 40 media posts in roughly 4 days.
- `/tags/<tag>.rss` works.
- mastodon.design's hashtag API returned 422 (public timelines restricted), but its RSS works.
- Free, but low volume.

**Threads:**

- The official keyword search (`/keyword_search`, `media_type` filter, TOP/RECENT) needs the `threads_keyword_search` permission and app review. Meta reference updated 2026-04-20: https://developers.facebook.com/documentation/threads/reference/media-retrieval
- Rate limits are unverified; third parties cite 2,200/day or 500/week.
- Too much setup for a v1.

---

## Recommendation for a simple v1

1. **Your X bookmarks into re-collect (official API, about $1–3/mo):**
   - Do a one-time OAuth2 PKCE consent (`tweet.read users.read bookmark.read like.read offline.access`) and store the refresh token in a Convex table or env.
   - A Convex cron action polls `GET /2/users/:id/bookmarks` (and optionally liked_tweets) with media expansions every few hours, stopping at the last-seen ID.
   - Each new post with photos becomes an image item, copied into R2 under a new immutable key and sent through the existing tagging pipeline.
   - This is your highest-signal taste data. Your own bookmarking becomes the capture UI.
2. **Discovery from X (official API, about $10–40/mo):**
   - Maintain a list of design accounts (an X List, or handles stored in Convex).
   - Once a day, run `search/recent` with `(from:a OR from:b …) has:images -is:retweet` within the 512-char limit (about 20–30 handles per query). Alternatively use `GET /2/lists/:id/tweets`, which can't filter by media, so you pay for text posts too.
   - Rank results with the existing visual tagging/embedding against your collection, and show the top N in a "Discover" view where saving promotes a post to an item.
   - Set a hard **spending limit** in the X console.
3. **Bluesky source, added for free:** the same pipeline over `getListFeed` / `getFeed` for a few design feeds or lists.
4. **Skip for v1:**
   - Grok (optionally add later as a weekly "suggest new accounts" job, about $1/mo).
   - Scrapers (only if the X bill bothers you; twitterapi.io would cut discovery to < $5/mo with vendor risk).
   - Nitter and RSSHub.

## If re-collect becomes multi-user

- **X costs scale per user.** Each user's discovery reads are billed, and the 3M posts/cycle cap is per app. Shared discovery sources can be fetched once and fanned out, and the 24h dedup helps.
- **Owned reads may not apply to other users:** it's unclear whether the $0.001 owned-read rate covers _other_ users' bookmarks read through your app ("your own data through your own app"). If not, it's $0.005/post. **Unverified.**
- **X Developer Agreement duties:** honor deletions, use display requirements, store per-user OAuth tokens, and expect app review and use-case scrutiny.
- **Grok** cost is per query per user. Budget enforcement and caching become necessary.
- **Scrapers become a real legal and ToS liability** for a product. Don't build on them.
- **Bluesky scales best:** it's free, open, and has atproto OAuth for per-user likes, bookmarks and follows. **Mastodon** needs per-instance OAuth.
- **R2 copies:** storing copies of others' images in R2 for many users raises copyright and takedown questions. Keep source links and attribution, and consider hotlinking or thumbnails until a user saves an item.
