# Cost of letting users add their own sources (estimate, 2026-11-14)

A research agent modelled what it would cost to let each user add 3–5 sources
(mostly Are.na channels, some RSS) to a shared, deduped pool. It worked from
the code as of `aff840c` and from Convex's pricing and limits pages, and timed
one Are.na poll from a home connection. **Decision for now: a curated pool
only** (see `discovery-research.md`, Prototype). This is what opening it up
would take.

**Bottom line:** it isn't expensive. Even the worst case modelled, 5,000 users
× 5 unique channels polled every 6 hours, costs about $75–200 a month on Pro.
With daily polling every scenario sits near Pro's $25 base, and once the
mitigations below are in, all of them fit it. The code breaks well before cost
matters, at around 100 users.

## Assumptions

- **Sources:** unique sources = users × sources each; "50% shared" halves that.
  Add the built-ins. 90% are Are.na channels.
- **Function calls per poll:** `getSource` + `unseen` + `recordPoll`, plus one
  `ingest` per 50 new candidates and one per-source `pollSource` action. That's
  ~4.25 calls per poll at 6-hourly polling and ~4.5 at daily.
- **Compute:** about 1 s of wall time per poll, billed at 64 MiB.
- **One Are.na poll (`per=100`):** 390–460 KB uncompressed (32–38 KB
  gzipped), about 0.6 s. The original seed channels added under 0.25 blocks a
  day.
- **Hidden database cost:** `unseen` does one lookup per fetched block, so a
  quiet poll still reads about 95 candidate docs (~95 KB).
- **Candidates:** about 1 KB each. Backfill is ~80 per new source; steady
  state is ~0.5 new per source per day.

## Monthly cost

Calls are in millions per month and I/O is database I/O. Each cost range spans
gzipped to uncompressed fetch egress, because it's unknown how Convex meters
fetched responses.

| Users × sources, overlap | Unique sources | Every 6h: calls / GB-h / I/O GB | Every 6h cost  | Daily cost       |
| ------------------------ | -------------- | ------------------------------- | -------------- | ---------------- |
| 100×3, none              | 309            | 0.16 / 0.6 / 3.3                | Starter $0.5–2 | free tier        |
| 100×5, none              | 509            | 0.26 / 1.1 / 5.4                | Starter $1–4   | Starter $0.1–0.7 |
| 1000×3, none             | 3,009          | 1.5 / 6.3 / 32                  | Pro $25–36     | Pro $25          |
| 1000×5, none             | 5,009          | 2.6 / 10 / 53                   | Pro $26–48     | Pro $25–26       |
| 1000×5, 50%              | 2,509          | 1.3 / 5.2 / 27                  | Pro $25–33     | Pro $25          |
| 5000×3, none             | 15,009         | 7.7 / 31 / 160                  | Pro $48–125    | Pro $25–40       |
| 5000×5, none             | 25,009         | 12.8 / 52 / 266                 | Pro $74–201    | Pro $28–57       |
| 5000×5, 50%              | 12,509         | 6.4 / 26 / 133                  | Pro $42–105    | Pro $25–36       |

- **Calls and compute** stay far under Pro's 25M calls and 250 GB-hours.
- **Storage:** the one-time backfill is 25K–2M docs. A year with no expiry
  comes to 0.06–10 GB.
- **Embeddings:** these are per unique candidate. EmbeddingGemma 2 is about
  $2 a month at the worst case; Gemini Embedding 2 is about $43. The real
  catch is that Convex bills each vector search at the full index size, so
  per-user kNN over a large shared index gets costly.
- **Feed query:** today it reads the user's keep/skip rows. If it also read
  their whole library (it no longer does), DB I/O at 1,000+ users would
  outgrow the polling cost.

## What breaks first (about 100 users, not cost)

1. **The `feed` query** reads 100 candidates per source. At ~300 sources
   that's over Convex's 16 MiB read limit per transaction, and any source's
   poll re-runs every open feed.
2. **`pollAll` runs everything in one action.** At a few hundred sources that
   means out-of-memory errors, then the 1,000-concurrent-requests cap or the
   30-minute timeout.
3. **Are.na without a token** gets 30 requests a minute per IP, and Convex's
   IPs are shared, so a burst mostly gets 429s. One app token (120 a minute)
   is enough if polls are spread out; heavy use should go through Are.na
   (Premium is 300 a minute) or per-user OAuth.
4. **A user-triggered refresh** would multiply polls. It has since been
   removed.
5. **After those fixes,** the first quota to go is DB I/O, mostly from
   `unseen`, and possibly egress if fetches are metered uncompressed.

## Cheapest mitigations

1. **Stagger polling.** Give each source a `nextPollAt` index and run a cron
   every 5–10 minutes that schedules one `pollSource` per due source, capped
   at about 60 Are.na requests a minute with one token.
2. **Track a cursor per source.** Store the newest `connected_at` and skip
   `unseen` when nothing is newer. Use `per=20` on routine polls and page
   further only if all 20 are new.
3. **Poll user sources daily, with backoff.** Double a quiet source's
   interval up to 7 days, and drop sources nobody follows.
4. **Bound the feed query** to the user's own subscriptions. Keep poll state
   out of the rows it reads.
5. **Expire and cap.** Expire untouched candidates after 30–60 days. Cap RSS
   bodies at about 1 MB and 30 items, and backfill at about 50.

## Sources and gaps

- **Sources:**
  - Pricing: https://www.convex.dev/pricing and https://www.convex.dev/plans.
    Pro includes 25M calls, 250 GB-h, 50 GB storage, 50 GB DB I/O ($0.20/GB
    over) and 50 GB egress ($0.12/GB over).
  - Limits: https://docs.convex.dev/production/state/limits
  - Usage metering: https://docs.convex.dev/production/usage-limits
  - Shared outbound IPs: https://docs.convex.dev/production/networking
  - Are.na limits: https://www.are.na/developers/explore
- **Not verified:**
  - Whether fetch egress is metered compressed, uncompressed or at all.
  - That GB-hours are 64 MiB × wall time.
  - Latency from Convex's datacenter IPs.
  - The feed-traffic assumptions.
