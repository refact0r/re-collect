# Embeddings — research (2026-11-05, model decided 2026-11-14)

Research for re-collect 2.0: embed every item so we can build "find similar",
vibe search, the library map, taste drift and discovery-feed ranking. Nothing
here is built. Prices were checked on official pages and the OpenRouter API
on 2026-11-05 unless marked _unverified_. The benchmark in
`experiments/embeddings/` ran every model below against the real prod
library. This builds on `reference/discovery-research.md` and revises its
model pick: Voyage turned out to be the weakest fit for vibe search (§1).

## Decision (2026-11-14)

**Build on EmbeddingGemma 2 (`google/embeddinggemma-2`, 768 dims) via
Cloudflare Workers AI (`@cf/google/embeddinggemma-2`).** A prototype is
built; see "Prototype" below.

- **Host:** Cloudflare started serving the model on 2026-11-12.
  - It costs $0.0017/M tokens, and its free tier covers our volume.
  - It runs on the Cloudflare account we already have.
  - The first pick was DeepInfra ($0.02/M). DeepInfra is now the spare for
    the same model; see "Where to run EmbeddingGemma 2".

- **Why:**
  - Quality tied Gemini in a blind head-to-head on every prod item, with a
    slight, non-significant edge (§1).
  - The priority is a low API price, and it's about 20× cheaper.
  - Open weights mean no lock-in.
  - Self-hosting is not a goal: local runs were only to measure quality.
- **Fallback:** `google/gemini-embedding-2` at 768 dims via the existing
  OpenRouter key, with the same architecture.
- **Before writing pipeline code:**
  1. Create a Cloudflare API token with Workers AI permission, and note the
     account ID.
  2. Embed ~5 prod images and 3 queries through Cloudflare, and check
     cosine > 0.99 against the local model (`experiments/embeddings/gemma.py`
     uses sentence-transformers with `prompt_name="Document"` for images and
     `"SearchQuery"` for queries).
  3. Match the prompts by prepending them yourself:
     `task: search result | query: …` for queries,
     `title: … | text: …` for text documents, and no prefix on images.
  4. Measure query latency; it needs to be under about 0.5 s for search.
  5. If any of these fail, try DeepInfra, then Gemini.
- **Settled during the thread:**
  - **768 is enough.** Gemini at its native 3072 dims did no better than
    at 768.
  - **Qwen3-VL-Embedding** (top of MMEB-v2) did worse on vibe search, and
    has no cheap international API.
  - **Voyage and Cohere** are document-tuned and clearly behind.
  - **SigLIP 2** is good, but has no cheap API.
- **Still untested:**
  - **Jina v5-omni** (~$0.02–0.05 per 1k images, SigLIP2-based) needs a
    Jina key.
  - **Amazon Nova** ($0.06 per 1k images) needs AWS Bedrock.
- **The benchmark data is ephemeral.** It lived in a session scratchpad and
  is gone. `experiments/embeddings/README.md` has the commands to rebuild
  it from a fresh read-only prod export. Prod had 95 items on 2026-11-14.

## Prototype (2026-11-14, branch `refact0r/embeddings`)

Built on the decision above, skipping the cosine-parity check (the user's
call). Three pieces, each its own commit, so search or the map can be
reverted alone:

- **Pipeline:**
  - `lib/embedder.ts` calls Workers AI and decides what an item embeds as.
    - Image items and visual/none links embed as their 1024px JPEG, with no
      prefix.
    - Notes, text-mode links and links whose capture failed embed as
      `title: … | text: …` (subject, og description, notes, styles, tags,
      content, host).
  - `taggingActions.embedItem` writes one `itemEmbeddings` row per item.
  - Every write that can change the input schedules it: add, update,
    screenshot settle and tagging settle. The run skips items that aren't
    ready and inputs it has already embedded (`inputKey`), so over-calling
    is cheap.
  - Failures are only logged. Use `embeddings:backfill` to fill gaps and
    after a model change.
  - Env: `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` (see `ops.md`).
- **Hybrid search (`/search`):**
  - `embeddings.search` returns the 64 nearest item ids. Query embedding
    takes 0.3–1.4 s, measured from a local backend.
  - Keyword matches stay the results. They're re-ranked by reciprocal rank
    fusion (k = 60) with their nearest-neighbour rank, and up to 24
    unmatched nearest items follow as "+ N similar".
  - Scores sit in a ~0.10 band whatever the query (nonsense tops out at
    0.65, like real queries), so they never filter. A nonsense query
    therefore shows "no exact matches + 24 similar".
- **Library map (`/atlas`):**
  - `embeddingMapActions.refresh` runs UMAP (umap-js; cosine,
    nNeighbors ≤ 15, minDist 0.2, seeded) in a Node action.
  - It Procrustes-aligns the result to the previous layout and caches it in
    `embeddingMaps`, one doc per user, capped at 8,192 points.
  - Opening the atlas calls refresh. It's a no-op when the signature of
    `itemId:inputKey` pairs is unchanged, but it still reads every vector
    to compute that.
- **Known gaps / next steps:**
  - The map's staleness check reads all vectors on each visit, about 6 KB
    an item. Before large libraries, add a cheap staleness marker.
  - There's no "find similar" in the item modal yet.
  - Prod isn't backfilled or deployed.
  - It was tested on a local Convex backend seeded from a dev snapshot.
    The shared cloud dev deployment kept being re-pushed by another
    checkout's watcher.

## TL;DR — recommendation

- **Model: Google's open-weight `embeddinggemma-2` (768 dims), via
  Cloudflare Workers AI** (`@cf/google/embeddinggemma-2`, live since
  2026-11-12; see "Where to run EmbeddingGemma 2"). It's on the Cloudflare
  account we already have, at about a twelfth of DeepInfra's price.
  DeepInfra is the second host for the same model. Fallback:
  `google/gemini-embedding-2` at 768 dims via OpenRouter. The same
  architecture works with any of them; only the model constant and
  endpoint change.
  - **EmbeddingGemma 2 tied for best in the benchmark** on vibe text→image
    queries (about 31/40) and on item→item neighbours, alongside a
    self-hosted SigLIP 2 so400m. Gemini scored about 28; Voyage and Cohere
    were clearly behind.
  - **Images and text share one space.**
  - **It costs about $0.006 per 1k images.** That's 20× cheaper than
    Gemini, though both round to zero.
  - **It's Apache-2.0, so there's no lock-in.** If one host disappears, the
    same weights run on the other host, on Modal or on a laptop and produce
    compatible vectors. No closed API offers that.
  - **The catch: it's a month old** (Oct 2026), and there are no published
    image benchmarks yet. **Before building, check that the hosted vectors
    match the local model** (cosine > 0.99 on a few items, for both
    Cloudflare and DeepInfra). It's a 10-minute test. The hosts count an
    image as 260 and 270 tokens, and the model card says 280, so their
    image preprocessing may differ. If a host doesn't match, use the other
    one. If neither matches, use Gemini.
- **Cost is a non-issue.**
  - Embedding the whole prod library (93 items) costs well under 1¢, and
    still under 1¢ at 10× (930 items).
  - At 100× (9,300 items) it costs $0.05 with EmbeddingGemma 2, or $1.08
    with Gemini.
  - Searches cost about $0.0000002 each.
  - A 1,000-a-day discovery feed costs $0.17 a month (Gemini: $3.48).
  - Convex storage and vector queries fit inside the free plan even at
    100×.
- **Schema: a separate `itemEmbeddings` table**, never a field on `items`.
  `items.list` collects every item and spreads the whole document to the
  browser. A 768-dim vector is about 6 KB as float64, so every list read
  and every client payload would get about 4× bigger.
- **Pipeline: one new step.**
  - `preprocessItem` and `repaletteItem` already fetch and decode every new
    image. Each hands the 1024px JPEG to a new `embeddings.embedImage`
    action.
  - Text-mode articles and text items embed their text instead.
  - The embedding row is the status, so `items` gets no new fields.
- **Rollout:**
  1. Pipeline + backfill + "find similar" (about 1–2 days).
  2. Hybrid vibe search with reciprocal rank fusion (1–2 days).
  3. Map + named clusters replacing `/atlas` (3–5 days).
  4. Drift and feed ranking on top.
- **Main risks:**
  - Similarity scores sit in a narrow band for both picks, so prefer ranks
    over thresholds.
  - Vectors from different models can't be mixed, so a model change means
    re-embedding everything. That's cheap: at most about $1 for 10k items.
  - The benchmark library is small (93 items).

## Cost table

EmbeddingGemma 2 on DeepInfra: $0.02 per million tokens, at about 280
tokens per image [doc]. On Cloudflare (the chosen host) it's $0.0017 per
million, about a twelfth of every EmbeddingGemma figure below, and inside
the free daily allowance at all of these sizes. Gemini Embedding 2 on OpenRouter costs $0.000116 per
image, measured. Library sizes are the prod item count on 2026-11-05: 93
items (dev has 45).

|                                                      | Now (93)                                              | 10× (930) | 100× (9,300) |
| ---------------------------------------------------- | ----------------------------------------------------- | --------- | ------------ |
| One-time backfill — EmbeddingGemma 2                 | **$0.0005**                                           | $0.005    | $0.05        |
| One-time backfill — Gemini Embedding 2               | $0.011                                                | $0.11     | $1.08        |
| Re-embedding after a model change                    | same as backfill                                      |           |              |
| New items (about 30/month at the Oct 2026 rate)      | $0.0002/mo (Gemini $0.0035)                           |           |              |
| Per search (query embedding)                         | ~$0.0000002 (Gemini ~$0.000002)                       | same      | same         |
| Vectors stored (counted in both DB and vector index) | 0.6 MB                                                | 5.7 MB    | 57 MB        |
| Query-GB per vector search                           | 0.0006                                                | 0.006     | 0.057        |
| Searches/month inside the free 3,000 query-GB        | ~5M                                                   | ~500k     | ~53k         |
| Discovery, 200 candidates/day                        | $0.03/mo (Gemini $0.70)                               |           |              |
| Discovery, 1,000 candidates/day                      | $0.17/mo (Gemini $3.48; $1.74 via Google's batch API) |           |              |

Other models for the same workloads, from the benchmark or official prices:

|                                                        | 93                                                    | 930    | 9,300 | 1k/day feed      |
| ------------------------------------------------------ | ----------------------------------------------------- | ------ | ----- | ---------------- |
| EmbeddingGemma 2 (DeepInfra)                           | $0.0005                                               | $0.005 | $0.05 | $0.17/mo         |
| Gemini Embedding 2 (OpenRouter)                        | $0.011                                                | $0.11  | $1.08 | $3.48/mo         |
| Voyage multimodal 3.5, via OpenRouter (1024px)         | $0.038                                                | $0.38  | $3.79 | $12.2/mo         |
| Voyage multimodal 3.5, direct (free allowance)         | $0                                                    | $0     | $0    | $0 for ~7 months |
| Cohere Embed 5 fast                                    | $0.025                                                | $0.25  | $2.48 | $8.0/mo          |
| Self-hosted SigLIP 2 on Modal                          | ≈$0 compute; the cost is hosting and cold starts (§1) |        |       |                  |
| For scale: current LLM tagging (gpt-6-luna, ≈$0.23/1k) | ≈$0.02                                                | ≈$0.21 | ≈$2.1 | —                |

## 1. Models

### Benchmark on the real library

`experiments/embeddings/bench.py` and `siglip.py` embedded all 93 prod
items, as the same 1024px JPEGs `preprocessItem` makes, with every model
below. Total spend was about 7¢. Three readouts:

- **Text→image hits.** I eyeballed the top-4 for 10 vibe queries
  ("swiss international typographic poster", "glitchy experimental digital
  art", "photo of a physical object", …), so 40 slots per model.
- **Item→item neighbours.** Contact sheets for 9 seed items.
- **Tag-Jaccard@5.** The mean overlap of `styles ∪ aiTags` between an item
  and its 5 nearest neighbours. Random neighbours score 0.026. This is a
  weak proxy, biased toward models that read text.

| Model                                                              | Dims     | $/image                                   | Image latency p50 | Query latency p50 | Query hits /40 | Tag-J@5   | Item→item read                                                                                                                                                          |
| ------------------------------------------------------------------ | -------- | ----------------------------------------- | ----------------- | ----------------- | -------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **EmbeddingGemma 2** (local; hosted on DeepInfra)                  | 768      | ~$0.000006 hosted                         | 0.59 s (CPU/MPS)  | 0.03 s            | **~31**        | 0.042     | **Visual and semantic.** A data-viz site's neighbours were a network graph, data posters and a flowchart. Found the two physical-object photos the other models missed. |
| Gemini Embedding 2 (OpenRouter)                                    | 3072→768 | $0.000116                                 | 0.72 s            | 0.38 s            | ~28            | 0.037     | Semantic plus visual. Groups by kind of thing (dev portfolios, fintech) as much as by look.                                                                             |
| Qwen3-VL-Embedding-2B (local, bf16; re-run 2026-11-14 on 95 items) | 2048     | no cheap serverless API (§1 hosted table) | 1.66 s            | 0.07 s            | ~22            | 0.036     | Leads MMEB-v2, but that measures instruction-style retrieval and VQA, not vibe. Weak on "editorial serif" and "photo of an object".                                     |
| SigLIP 2 so400m (local, M-series GPU)                              | 1152     | self-host                                 | 0.34 s            | 0.05 s            | **~30**        | **0.044** | **Most visual.** A data-viz site's neighbours were dashboards, a globe map and a network graph.                                                                         |
| SigLIP 2 base (local)                                              | 768      | self-host                                 | 0.03 s            | 0.01 s            | ~22            | 0.039     | Noticeably weaker than so400m.                                                                                                                                          |
| Voyage multimodal 3.5                                              | 1024     | $0.000407                                 | 0.39 s            | 0.27 s            | ~17            | 0.036     | Good on layout and sparse pages; reads the text in images. Poor on vibe words: "editorial serif" returned dark sites.                                                   |
| Cohere Embed 5 fast                                                | 2048     | $0.000267                                 | 0.39 s            | 0.23 s            | ~14            | 0.031     | Colour and texture driven. Weakest overall.                                                                                                                             |
| Tag text → text-embedding-3-small                                  | 1536     | $0.000002                                 | —                 | 0.08 s            | ~27            | 0.046     | Matches on topic, not look (§2).                                                                                                                                        |

Takeaways:

- **EmbeddingGemma 2, SigLIP 2 so400m and Gemini are the top tier, and the
  two document-oriented APIs are clearly behind for vibe search.**
  EmbeddingGemma 2 has no third-party benchmarks yet; the rest matches the
  outside evidence:
  - Google's paper reports image→image GUIEC R@1 of 79.4 for Gemini
    Embedding 2 vs 69.4 for Voyage mm-3.5.
  - An independent product-image benchmark (arXiv 2603.17186) put Gemini 2
    (43.8) roughly level with SigLIP2-400M (43.4), and ahead of Cohere v4
    (35.8) and Jina v4 (28.5).
  - Voyage and Cohere are tuned for reading text in documents, judged by
    ViDoRe scores, where they lead.
- **Gemini's 3072→768 truncation (MRL) holds up.** It keeps 89% of the top-5
  neighbours, and the query results are near-identical. 256 dims keeps only
  59%.
- **Scores are compressed for both picks.** The 5th–95th percentile spread
  of pairwise cosines is 0.13 for EmbeddingGemma 2, 0.17 for Gemini and 0.32
  for Voyage. Gemini image↔image cosines average 0.60. Any fixed
  threshold, such as near-duplicate detection or a search floor, must be
  calibrated per model. The 0.97 dedupe figure in discovery-research.md is
  a guess.
- **The library is small (93), and the query labels are mine.** This is a
  sanity check, not an eval. It's enough to rule out Cohere and Voyage for
  vibe search. It doesn't separate the top three: EmbeddingGemma 2 wins on
  lock-in and price, not on a measurable quality gap.

### Head-to-head: EmbeddingGemma 2 vs Gemini Embedding 2 (2026-11-14)

This was a blind A/B on every prod item (95), with both models at 768 dims
(`experiments/embeddings/h2h.py`).

- **Item→item:** for each item, the two models' top-5 neighbours were shown
  as rows X/Y, shuffled per item, and judged "which row is more similar"
  before the key was read.
- **Text→image:** 30 vibe queries, the original 10 plus 20 new ones, judged
  on their top 5 the same way.
- The models really do disagree. They share only 1.9 of each item's top 5
  neighbours on average, so this isn't comparing near-identical lists.

|                                      | EmbeddingGemma 2 wins | Gemini wins | Tie | Sign test |
| ------------------------------------ | --------------------- | ----------- | --- | --------- |
| Item→item (95 items)                 | 33                    | 28          | 34  | p = 0.61  |
| Text→image (30 queries)              | 12                    | 8           | 10  | p = 0.50  |
| Item→item, Gemini at full 3072 dims  | 36                    | 24          | 35  | p = 0.16  |
| Text→image, Gemini at full 3072 dims | 12                    | 7           | 11  | p = 0.36  |

- **Gemini at its native 3072 dims doesn't help.** Its top 5 differs from
  the 768-dim top 5 on 49 of 95 items (usually by a single item) and on 19
  of 30 queries. Re-judged blind with a new shuffle, those cases moved
  slightly toward EmbeddingGemma 2. That's within judging noise: re-judging
  the same subset at 768 had already shifted by a few calls. So 768 costs
  Gemini nothing, and 3072 would just quadruple storage and query-GB.
- **Verdict: no meaningful quality difference.** EmbeddingGemma 2 has a
  small edge in both, but neither margin is significant.
- **Neither model favours a kind of item.** URL and image items split the
  same way for both.
- **Where each tended to win:**
  - **Gemini** more often grouped by kind of site, e.g. fintech next to
    fintech.
  - **EmbeddingGemma 2** more often caught visual traits: line art, pixel
    art, dark or orange palettes, the object photos.
- **The choice rests on price, lock-in and operations, not quality.**
  EmbeddingGemma 2 is about 20× cheaper and open-weight. Gemini reuses the
  OpenRouter key and has more track record.
- **Caveat: one judge** (me), with many close calls.

### Hosted APIs (verified 2026-11-05)

| Model                                                                                   | Shared text–image space         | Dims                                            | Image price                                                                                                                                                                                         | Text price                 | Limits, input                                                                                                                                       | Data use and lock-in                                                                                                                                                                                           |
| --------------------------------------------------------------------------------------- | ------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Google `embeddinggemma-2` on DeepInfra** (also on Cloudflare at $0.0017/M; see below) | yes, all modalities             | 768; MRL 512/256/128                            | about 280 tok × $0.02/M ≈ **$0.0000056**                                                                                                                                                            | $0.02/M                    | OpenAI-compatible `/v1/openai/embeddings`; `image_url` (URL or data URL); `task: "document"` / query task prompts; 8,192 tokens                     | **Apache-2.0 open weights**, so you can self-host the same model and keep your vectors. DeepInfra advertises zero retention. Released 2026-10-06. Not on OpenRouter.                                           |
| Google `gemini-embedding-2`                                                             | yes, all modalities             | 3072; MRL 128–3072, 768 recommended; normalized | flat 258 tok × $0.45/M = **$0.000116**; batch $0.00006 (direct API only)                                                                                                                            | $0.20/M                    | 6 images, 8,192 tokens per request; base64 or the Files API, no plain URLs; **no `task_type`**: use prefixes like `task: search result \| query: …` | Paid tier isn't trained on; the free tier is. Changing the model generation means re-embedding (001 and 2 spaces are incompatible). On OpenRouter at Google's price, and `dimensions` passes through (tested). |
| Voyage `voyage-multimodal-3.5`                                                          | yes                             | 1024; 256/512/2048; int8/binary                 | $0.60 per billion pixels (50k px min, 2 MP max billed): **$0.00047** at 1024×768, $0.00016 at 512²                                                                                                  | $0.12/M                    | 2,000 RPM, 1,000 inputs per request; URL or base64                                                                                                  | **Trains on inputs by default.** Opting out needs a card on file. 150B free pixels when called directly. Owned by MongoDB. No multimodal-4 model exists.                                                       |
| Cohere `embed-v5.0-pro` / `-fast` (Sep 2026)                                            | yes; Pro and Fast share a space | 2048; 256–1536; int8/binary                     | $0.40 per million image tokens, but tokens per image aren't documented (about $0.0005–0.002); OpenRouter measured **$0.00027**                                                                      | $0.12 / $0.08 per M        | 400 images/min; base64 only, 96 inputs per call                                                                                                     | Opt-out with a card on file. Document-tuned.                                                                                                                                                                   |
| Jina `jina-embeddings-v5-omni-small` / `-nano`                                          | yes; SigLIP2-based image tower  | 1024 / 768; MRL to 32                           | ~1k tokens per 1024² image × $0.05 or $0.02/M, about **$0.00005 / $0.00002**                                                                                                                        | $0.05 / $0.02 per M        | 500 RPM paid; URL or base64                                                                                                                         | "Never used to train". The non-commercial licence covers the weights only, not the API. Owned by Elastic. **Not tested** (not on OpenRouter); the most CLIP-like hosted option.                                |
| Qwen `qwen3-vl-embedding` (Alibaba Model Studio; open weights Apache-2.0, 2B/8B)        | yes                             | 2560 (256–2560) hosted; 2B open model 2048      | Beijing region: 1.8 CNY/M image tokens; an image is about 1 token per 32×32 px, so roughly **$0.0002** for 1024×768 [inferred]; no verified international price. 8B on STACKIT/IONOS ≈ $0.09–0.11/M | 0.7 CNY/M                  | 2,400 RPM (Beijing)                                                                                                                                 | Top of MMEB-v2 image, but it **lost to EmbeddingGemma 2 and Gemini in the benchmark** (~22/40). Not on OpenRouter or DeepInfra.                                                                                |
| Amazon Nova multimodal embeddings                                                       | yes                             | 3072; 1024/384/256                              | $0.00006 standard image mode ($0.0006 document mode)                                                                                                                                                | $0.135/M                   | us-east-1 only, one input per call                                                                                                                  | AWS account and Bedrock setup. Not tested.                                                                                                                                                                     |
| Amazon Titan G1                                                                         | yes                             | 1024                                            | $0.00006                                                                                                                                                                                            | $0.80/M, **256-token cap** | —                                                                                                                                                   | 2023-era. Can't embed articles.                                                                                                                                                                                |
| NVIDIA Nemotron 3.5 embed (free on OpenRouter)                                          | yes                             | 2048/4096                                       | $0                                                                                                                                                                                                  | $0                         | **3.6% uptime** on the day checked                                                                                                                  | Document-tuned. Not a dependency to build on.                                                                                                                                                                  |
| OpenAI, Mistral                                                                         | **no image embeddings**         |                                                 |                                                                                                                                                                                                     |                            |                                                                                                                                                     |                                                                                                                                                                                                                |

### Where to run EmbeddingGemma 2 (checked 2026-11-14)

Only two hosts serve it as a serverless per-token API. Each was checked
against the provider's own catalogue.

| Host                                                    | Price                                                                         | Per image (≈ tokens)  | Image input                                                                            | Query/document prompts                                                                               | Dims                                      | Notes                                                                                                                                                                                   |
| ------------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cloudflare Workers AI** `@cf/google/embeddinggemma-2` | **$0.0017/M input tokens** (154 neurons/M); 10k free neurons/day ≈ 65M tokens | 260 → **$0.00000044** | `messages` content parts, `image_url` with a **base64 data URL only** (no remote URLs) | **Do it yourself:** `task: search result \| query: …` and `title: … \| text: …`; no prefix on images | 768; `dimensions` 512/256/128 (MRL)       | Launched 2026-11-12, not labelled beta. Zero retention. REST `POST /client/v4/accounts/{id}/ai/run/@cf/google/embeddinggemma-2`. Rate limit not stated (text embeddings get 3,000 RPM). |
| DeepInfra `google/embeddinggemma-2`                     | $0.02/M tokens                                                                | 270 → $0.0000054      | OpenAI-style `image_url`, an https URL or a data URL                                   | `task` parameter (`search_query`, `document`, `clustering`, …)                                       | 768; `dimensions` 512/256/128; normalized | OpenAI-compatible `/v1/openai/embeddings`. Zero retention.                                                                                                                              |

Not available, as of this check:

- **OpenRouter:** not in the embeddings model list (404 on the model page).
- **Google itself:** not offered on AI Studio / the Gemini API or Vertex AI.
  Google offers only Gemini Embedding there.
- **Hugging Face Inference Providers:** "isn't deployed by any Inference
  Provider".
- **Together, Fireworks, Replicate, Novita and Baseten:** not offered
  (Baseten has only EmbeddingGemma 1, the 300m model).
- **FlexAI and Vast.ai:** dedicated GPUs only (FlexAI: $2.10 per H100-hour),
  which is pointless at this volume.
- Nebius, Scaleway and SambaNova couldn't be checked.

**Pick: Cloudflare.**

- **No new vendor.** The screenshot worker and R2 already live on that
  account. It needs a Workers AI API token and the account ID in Convex env.
  That's a new secret, but not a new vendor or bill.
- **Effectively free.** The free 10k neurons a day cover about 250k images
  a day. Past that, 100× the library (9,300 items) costs about $0.004.
- **The pipeline already has the bytes.** The base64-only input costs
  nothing: `preprocessItem` already holds the 1024px JPEG, and discovery
  candidates get fetched anyway.
- **Writing the query/document prompts ourselves is a one-line helper.**
  It also keeps the exact prompt strings in our code, the same ones the
  local `gemma.py` benchmark used.

**DeepInfra is the hot spare.** It serves the same model, so if
Cloudflare's vectors match the local model, switching hosts needs no
re-embed. Unless the parity check fails, the only reasons to prefer
DeepInfra are remote image URLs and the built-in `task` parameter, and
neither matters here.

Measure query latency on both before building; neither host documents it.
The search query is the one call that needs to come back in under about
0.5 s.

Cloudflare's text-only `embeddinggemma-300m` (EmbeddingGemma 1) is retired
on 2026-11-20. Workers AI has no other multimodal embedding model.
Vectorize (1,536-dim max, topK 100) isn't needed, because Convex vector
search covers it.

### Self-hosted CLIP / SigLIP

| Option                                                           | Quality                                              | Cost at this volume                                        | Catch                                                                                                                                                  |
| ---------------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **SigLIP 2 so400m** on Modal (T4/L4, $30/mo free credit)         | Best visual neighbours in the benchmark              | about $0.01 per 1k images; effectively $0                  | A cold start of about 3–10 s on the first search after idle. Python service to deploy and keep alive. Two codebases.                                   |
| HF Inference Endpoints, scale-to-zero                            | same                                                 | $0.50/h T4 while up; $24/mo for an always-on CPU           | Cold start takes minutes (it returns 503 while waking): unusable for search.                                                                           |
| Replicate public CLIP ViT-L/14                                   | Older CLIP                                           | about $0.22 per 1k                                         | Public models go cold. ViT-L CLIP is a generation behind SigLIP 2.                                                                                     |
| In a Convex Node action (transformers.js / onnxruntime)          | —                                                    | —                                                          | **Doesn't fit.** onnxruntime-node is 293 MB; Convex's package limit is 230 MB. SigLIP 2 base needed 1.2 GB peak with both towers; the limit is 512 MB. |
| In the browser, query side only                                  | CLIP B/32 or MobileCLIP text tower                   | $0                                                         | A 43–64 MB download; SigLIP 2's text tower is 283 MB. The image side still needs a server.                                                             |
| **EmbeddingGemma 2** (Google, Oct 2026, Apache-2.0) on DeepInfra | ~31/40 queries; neighbours on par with SigLIP so400m | $0.02/M tokens, about **$0.006 per 1k images**, serverless | New, with no published image benchmark. **Open weights mean no lock-in**: the same vectors can come from DeepInfra, Modal or a laptop.                 |

**Verdict.** Self-hosting SigLIP 2 buys a little visual quality, and costs
a second service plus a cold-start problem on the one latency-sensitive
call: embedding the search query. A hosted serverless API has neither
problem. Self-hosting only makes sense if quality on a bigger library
clearly beats EmbeddingGemma 2 and Gemini. EmbeddingGemma 2 is the middle
path: hosted today, self-hostable later without re-embedding.

### Image-only vector plus a text-tag vector

The two alternatives to one shared space:

- An image-only model such as DINOv2, plus a text embedding of `subject +
styles + aiTags`, gives two unrelated spaces. "Find similar" uses the
  image space; vibe search embeds the query into the text space and only
  ever sees what the tagger wrote. The benchmark's tag-text row shows that
  works about as well as Gemini for queries, because the tagger is good.
  It's still worse in three ways:
  - **Two models to run.**
  - **Untagged items are invisible to search**, and 8 prod items have
    tagging off.
  - **Discovery candidates must be tagged before they can be searched.**
- Embedding the LLM description instead of pixels is covered in §2. It's a
  complement, not a replacement.

A shared space gets both from one vector. It also allows mixing modalities:
a text "taste prompt" can be ranked against images, and text items can be
compared with images.

## 2. What to embed

**One primary vector per item, picked by the switch that already picks the
tagging mode.** What the tagger reads is what gets embedded:

| Item                             | Embed                                                                                                          | Why                                                                                                                                                                                                                                                   |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `image`                          | the 1024px JPEG from `preprocessItem`                                                                          | It's the item.                                                                                                                                                                                                                                        |
| `url`, visual or `none` tagging  | the item's image (`imageKey`), whether it's a screenshot or an og:image                                        | It's what the grid shows and what the user chose with `linkImageMode`. Don't fetch the other one. The og:image is often marketing art rather than the page, so an og item clusters with posters, not websites. That's correct for what the user sees. |
| `url`, `text` tagging (articles) | text: `title + subject + aiTags + the first ~2k chars` of the article text that `tagTextItem` already extracts | An article screenshot is a wall of type. Its vector only says "text-heavy page" and pulls every article together.                                                                                                                                     |
| `text`                           | `title + content`                                                                                              | Prod has none today.                                                                                                                                                                                                                                  |

- **Not the AI tags inside the image vector.** The tags are a lossy reading
  of the same pixels. The vector is more useful as an independent signal.
- **Not user notes inside the primary vector.** Only 2 of 93 prod items have
  notes. They're already in the lexical `searchText`, and they change, which
  would force a re-embed.
- **Page text for visual URL items: no.** It costs a fetch and a Defuddle
  pass per item, and for a design reference the look is the point.

**Embedding the LLM description instead of pixels** (`subject + styles +
aiTags` through a text model) did surprisingly well in the benchmark. It got
the best tag-agreement score, but that metric is biased toward it. Its
neighbours match on topic: a fintech site's neighbours were other fintech
sites, while the image vectors returned other dark, dense, monospace pages.
It's not a replacement:

- It only exists after tagging, and `taggingMode: 'none'` items have no
  tags.
- Re-tagging moves the vector.
- Discovery candidates would need tagging ($0.23/1k) before they could be
  ranked, instead of just embedding ($0.12/1k).
- It loses layout, colour and texture, which is what "find similar"
  is for.

**A second, text vector per item (later, optional).** This is design.md's
`semanticText`: `title + notes + subject + styles + aiTags`, embedded in the
same space as `source: 'text'` rows. It costs about nothing. Summing
the unit image and text vectors made neighbours more semantic and less
visual in the benchmark. That's a better fit for search than for "find
similar". Hybrid lexical+vector search (§5) already gets most of that
benefit, because `searchText` holds the same tags, so defer this until
search quality says otherwise.

**The modality gap is real.** In Gemini space, image↔image cosines average
0.60, but an image against another item's text averages 0.32. An image
still retrieves its own LLM description top-1 95% of the time, so the
alignment is good, but text-vector items will form their own island on
the map and rarely show up as image neighbours. Keep `source` on every row
so features can treat the two kinds separately.

## 3. Cost model

**Library size.** These were read-only `npx convex data items` reads on
2026-11-05:

- **Prod:** 93 items (70 url, 23 image), all with images. 85 are tagged.
  The average document is 1.8 KB.
  - Growth: 14 items in Aug, 15 in Sep, 30 in Oct.
  - 8 are text-mode articles and 8 have tagging off.
  - 0 are `text` items.
- **Dev:** 45 items, a stale subset of prod from Jan–Aug.

**Embedding API.** Figures are measured over the 93 prod images at 1024px
through OpenRouter, except EmbeddingGemma 2, which comes from DeepInfra's
listed price.

| Model                        | $/image                  | How it's billed                                                             | Text query                         |
| ---------------------------- | ------------------------ | --------------------------------------------------------------------------- | ---------------------------------- |
| EmbeddingGemma 2 (DeepInfra) | ~$0.0000056              | about 280 tokens × $0.02/M                                                  | $0.02/M, so about $0.0000002       |
| Gemini Embedding 2           | $0.000116                | flat 258 tokens × $0.45/M, any resolution                                   | $0.20/M tokens, so about $0.000002 |
| Voyage multimodal 3.5        | $0.000407 (mean 0.68 MP) | $0.60 per billion pixels, so it scales with resolution: 512² costs $0.00016 | $0.12/M                            |
| Cohere Embed 5 fast          | $0.000267                | image tokens × $0.40/M                                                      | $0.08/M                            |

EmbeddingGemma 2 and Gemini bill a flat amount per image, so downscaling
only saves upload bandwidth. For Voyage, sending 512px instead of 1024px cuts the cost 2.5×.

**Convex** (docs fetched 2026-11-05):

- **Storage.** Vectors must be `v.array(v.float64())`, so 768 dims are
  about 6.1 KB per row. That's counted once as document storage and again
  in the vector index under search storage. Free and Starter include
  0.5 GB of each.
- **Vector queries.** Each search is billed in query-GBs for **the whole
  index**, regardless of filters or result count. Free and Starter include
  3,000 query-GB a month, then $0.11 per 1,000.
- **Database I/O.** 1 GB a month on Free and Starter, then $0.22/GB. This
  is the line that a vector on `items` would hurt (§4).
- **Limits.** Dimensions can be 2–4096. An index allows up to 16 filter
  fields, but filters are equality-only, combined with `q.or`. A search
  returns at most 256 results. A table can have at most 4 vector indexes.
  Search runs in actions only. Arrays hold at most 8,192 elements, so
  3072-dim vectors fit, but they triple the storage.
- **Multi-user (now on main: every owned table has `userId`).** Copy
  `userId` onto each embedding row and add it as a filter field. Each search still bills the
  _whole_ index, every user's vectors included, so query-GB grows with
  total users × library size, not with the size of the caller's own
  library. With a few friends it's still well inside the free quota.
- **Collections.** The docs show only scalar `q.eq` and `q.or` filters.
  Whether `eq` on an array field like `items.collections` matches
  membership is _unverified_, so assume it doesn't. To find similar items
  within a collection, over-fetch (limit 256) and post-filter after
  hydration. At this library size, 256 results covers most of the library
  anyway.
- **Backfill.** A vector index can be declared `staged: true` so it builds
  asynchronously on deploy. That's unnecessary at 93 rows, useful at 10k+.

**Discovery candidates.** Embedding is cheap. Storing vectors isn't free:

- At 1,000 candidates a day with 60-day retention, that's 60k × 6.1 KB, or
  about 370 MB. That's most of the free plan's 0.5 GB, and it's doubled if
  candidates get a vector index.
- So score candidates against **precomputed taste centroids** inside the
  action, with no index (§5). Store a candidate's vector only if it's
  kept, by copying it into `itemEmbeddings`, or skipped, for the negative
  signal. Skipped vectors can be packed `v.bytes()` float32 (3 KB) or int8
  (768 B), since they never need an index.
- kNN against the library with `vectorSearch` at 1,000 candidates a day
  costs 30k × 0.057 query-GB, about 1,700 query-GB a month at 100× library
  size. That fits, but it's half the free quota, and it grows with users.
  At today's size it's about 17 query-GB.

## 4. Architecture

### Schema: a separate table

```ts
itemEmbeddings: defineTable({
	itemId: v.id('items'),
	userId: v.id('users'), // copied from the item, immutable
	source: v.union(v.literal('image'), v.literal('text')),
	model: v.string(), // e.g. 'google/embeddinggemma-2@768', like taggingModelVersion
	embedding: v.array(v.float64())
})
	.index('by_item', ['itemId'])
	.vectorIndex('by_embedding', {
		vectorField: 'embedding',
		dimensions: 768,
		filterFields: ['userId', 'model', 'source']
	});
```

Why not a field on `items`:

- **`items.list` reads every item with `.collect()` and returns `...item` to
  the browser.** A 6.1 KB vector on a 1.8 KB document is about 4.4× the bytes
  on every list read. That's every reactive re-run, and there are 3–4 per
  new item while the pipeline patches status. It's also 4.4× the websocket
  payload, and those bytes count against the 1 GB a month of database I/O.
  At 100× that's 57 MB per list read.
- Convex's own docs recommend a separate table when documents are read in
  bulk.
- **Writing an embedding should never invalidate the grid.** With a separate
  table, embedding writes don't touch `items` subscriptions at all.

**No status fields on `items`.** The row is the status: a row whose `model`
matches the current constant means done, and a missing or stale row means
pending. Failures go to the logs, and the sweep below retries them. Add an
`embeddingError` only if the UI ever needs to show one. Today nothing does,
and every `items` write costs a grid re-render.

**`model` as a filter field** means a same-dimension model change is just
a backfill plus flipping a constant. Searches filter on
`q.eq('model', CURRENT)`, so old and new rows coexist during the switch
and never mix. A change of dimension needs a second vector field and
index on the same table (up to 4 are allowed), or a new table. Backfill
it, switch the readers, then drop the old one.

### Pipeline

```
items.add / screenshots.setCompleted
  └─ preprocessItem (node)  ─┬─ setPaletteHex
     or repaletteItem (node) ├─ callOpenRouter (tagging, visual mode only)
                             └─ embeddings.embedImage { itemId, imageKey, jpegBase64 }   ← new
tagTextItem (text mode)      └─ embeddings.embedText { itemId, text }                     ← new, after tagging
items.update (text items, content/title changed) → embeddings.embedText
items.remove → delete itemEmbeddings rows by_item
```

- **Both node actions already fetch and decode every new image.**
  `repaletteItem` is the one that runs when tagging is off. Move the
  `jpeg({quality: 85})` encode into the shared `fetchAndDecode` path and
  schedule `embedImage` from both. Embedding then runs even when tagging is
  off or fails. Visual URL items, images, and items with tagging off all
  have an image, so every item ends up embedded.
- **`embedImage` runs in the default runtime** because it's just a
  `fetch`, like `callOpenRouter`. It's one Workers AI `ai/run` call,
  sending the JPEG as a data URL in a `messages` `image_url` part (the
  fallbacks use the OpenAI-style `/embeddings` instead). It skips the
  write if `item.imageKey`
  changed while it ran: a screenshot retry produces a new key and a new
  run. Then it upserts by `itemId` + `source`. The JPEG is about
  100–300 KB of base64, well under the 16 MiB argument limit.
- **Retries:** reuse the `tagWithRetries` shape, with 3 attempts and 1 s / 3 s
  backoff, then log. Add one internal mutation, `embedMissing`, that scans
  items without a current-model row and schedules them. That covers both
  failures and the backfill. Workpool is already installed, but at this
  volume a staggered `runAfter` loop like migration 013 is enough.
- **Text-mode articles:** `tagTextItem` already has `article.text`. Embed
  `title + subject + aiTags + text.slice(0, 2000)` after `setCompleted`. If
  tagging fails, embed `title + text` anyway.
- **Query embeddings** are a plain `fetch` from the search action with
  `dimensions: 768`. Gemini took about 0.4 s through OpenRouter; measure
  Cloudflare.

### Backfill migration

`migrations/014_embed_items.ts` is an `internalMutation` that pages through
`items` and, for each one without a current-model row, schedules
`embedItem({ itemId })` with `runAfter(i * 300)`:

- `embedItem` is a node action that fetches from R2 and resizes, reusing
  `fetchAndDecode`, then calls `embedImage`. For text-mode or `text`
  items it embeds the text, re-extracting the article.
- 93 items take about 30 s and cost 1¢. 10k items would run about an hour
  at that pace.
- It's safe to rerun, because it skips items that are already done. That
  makes it the same function as `embedMissing`, so write it once and call
  it from both.

### Changing models

1. Bump the `EMBEDDING_MODEL` constant, or add a new field and index if
   the dimensions change.
2. Run the backfill. Old rows still serve reads, because readers filter on
   the old model until the switch.
3. Switch readers to the new model.
4. Delete the old rows.
5. Recompute cached derivations: map layout, cluster centroids and
   names, and taste centroids. They're keyed by model.

Cost: about $1 per 10k images. Never compare scores across models: in the
benchmark, Gemini image↔image cosines sat at 0.60 ± 0.09, while Voyage's
were 0.27 ± 0.16. Thresholds are per model.

## 5. What it unlocks

Effort is for one person who knows the codebase: S ≈ half a day, M ≈ 1–2
days, L ≈ 3–5 days, including UI.

### Find similar — S

- `embeddings.similar({ itemId })` is an action. It loads the item's row
  (internal query `by_item`), then runs `ctx.vectorSearch('itemEmbeddings',
'by_embedding', { vector, limit: 24, filter: q => q.eq('model', MODEL) })`.
  Add `userId` to the filter on multi-user.
- Drop the item itself and hydrate the rest through one internal query
  that keeps the search order. Return the items with their scores.
- To search within a collection, set `limit: 256` and post-filter on
  `item.collections`.
- **UI:** a "More like this" strip in the item modal. The results aren't
  reactive (it's an action), and that's fine.
- **Free extras:**
  - "More like these" on a multi-select: search with the mean of the
    selected vectors.
  - Near-duplicate warning at add time: a top-1 score above a calibrated
    threshold.

### Semantic ("vibe") search — M

- `embeddings.searchSemantic({ query })` is an action. It embeds the query
  with the model's query prompt, the `task: search result | query:` prefix
  (on Cloudflare, and for Gemini),
  then runs `vectorSearch` with limit 50. That's about 0.4–0.6 s end to
  end.
- **Merge with lexical search using reciprocal rank fusion:**
  `score(d) = Σ 1/(60 + rank_list(d))` over the lexical list (`items.search`,
  already `take(50)`) and the vector list. RRF needs no score
  normalization, which matters because Gemini's cosines are compressed
  (§1). It also respects design.md's rule that exact lexical matches signal
  intent: an item that ranks high in both lists wins.
- **Progressive UI:** show the reactive lexical results right away, then
  re-rank when the action returns. A query with zero lexical hits ("calm
  but technical") is where vectors earn their keep.
- **No hard score floor.** Cap at about 30 merged results. If a floor is
  needed later, make it relative, e.g. drop vector hits below the top
  score minus 0.1, rather than an absolute cosine.
- **Optional later:** cache query vectors in a small `queryEmbeddings`
  table keyed by the normalized query string. It saves about 0.4 s on
  repeats; the cost is irrelevant.

### 2D map replacing `/atlas` — L

- **Compute:** a Convex Node action loads all vectors (93 × 6 KB; 57 MB at
  100× is fine in 512 MB) and runs UMAP with a fixed random seed.
  - Use Apple's `embedding-atlas`: Rust→WASM, MIT, with a `/svelte` export.
    It handles 10k points in 34 s at about 200 MB.
  - Or use `umap-js`: 1k points in 1.2 s, 5k in 7 s, but it ran out of
    memory at 10k × 1024 dims without PCA to 128 first.
  - At the current size either takes under 2 s.
  - **Not in the browser:** it would mean shipping every vector to the
    client (about 6 MB at 1k items, 60 MB at 10k).
- **Cache:** one `mapLayouts` document `{ model, computedAt, itemIds[],
x[], y[], cluster[] }`, stored as parallel arrays, about 60 B per point.
  10k points is about 600 KB, under the 1 MiB document limit. Past that,
  split it into chunks. The `/atlas` page joins it with the items list it
  already loads.
- **Refresh:**
  - **New items between refreshes:** place each at the weighted mean of its
    5 nearest neighbours' coordinates, computed at embed time from the
    `vectorSearch` scores. It's cheap and looks right.
  - **Full recompute:** run on demand and in a nightly cron when the item
    count has changed by 5% or more since the last layout.
  - **Keep the map from jumping:** align the new layout to the old one
    with Procrustes on shared items (rotation, scale and flip) before
    saving.
- **UI:** a pan-and-zoom canvas of thumbnails, with cluster labels at the
  centroids. The existing atlas colour fingerprint can stay as one layer.

### Clustering + LLM cluster names — M (after the map)

- **Clustering:**
  - k-means on the 768-d vectors (`ml-kmeans`, k ≈ √(n/2), so about 7 now
    and 70 at 10k).
  - Or HDBSCAN on a 10-d UMAP, but it scales as n² and hits about 5 minutes
    at 10k.
  - Or `embedding-atlas`'s density clustering on the 2D map, which comes
    free with the layout.
  - Store the cluster ids in the same layout document.
- **Naming:**
  - For each cluster, send the ~10 items nearest its centroid, plus their
    `styles`, `aiTags` and `subject`, to the tagging model as **text
    only**. Ask for a 2–4-word name and a one-line description, in the
    voice of the existing style vocabulary.
  - About 1k tokens per cluster: about $0.0002 each, so about 1¢ for 50
    clusters. Add 4 thumbnails per cluster only if text-only names come
    out generic.
- **Cache names by membership:** keep a name while ≥70% of the cluster's
  members are unchanged, and re-name only the clusters that moved. Clusters
  are keyed by their centroid's nearest item, so ids survive re-runs.
- **This is the tags vocabulary goal from design.md, at a higher level.**
  Clusters name the aesthetics the user keeps returning to, even ones no
  single tag captures.

### Taste centroids and drift — S–M (after clustering)

- **Centroids:** the mean vector over a rolling 90-day window, monthly.
  - **Drift** is the cosine distance between consecutive centroids.
    - **The number alone means little.** Pair it with the clusters whose
      share grew or shrank the most, e.g. "more terminal/brutalist, less
      editorial illustration".
  - **"Cluster share over time"** (a stacked area chart by month) is the
    more legible view.
  - **"Outliers"** are items far from every cluster centroid: new
    directions.
- **Small-N warning:** prod had 1–30 items a month. Months with fewer than
  about 10 items are noise, so use rolling windows, not calendar months.
- **Compute:** inside the map action. It's nearly free.

### Feed ranking — M (in the discovery project)

- **Score with centroids, not `vectorSearch`.** Each candidate's score is
  the max over the user's k-means cluster centroids, plus the mean of the
  top-3, computed in the action.
  - Centroids are stored per user and per model. They're recomputed with
    the map.
  - This costs 0 query-GB, works with any number of users, and needs no
    candidate vector index. That's what keeps candidate storage off the
    free plan's 0.5 GB (§3).
  - It still reflects the multi-aesthetic library that
    discovery-research.md's kNN argument was about, because clusters are
    the aesthetics.
- **`vectorSearch` only for the top ~30 shown candidates**, to produce the
  "similar to X, Y, Z" explanation.
- **Negative signal:** keep the vectors of skipped candidates, packed as
  `v.bytes()`, and maintain a "skipped" centroid. Subtract λ·sim(skipped).
- **On keep:** copy the candidate's vector into `itemEmbeddings` with the
  same model, so it never needs re-embedding. That only works if
  candidates and items share a model, which is one more reason to pick
  one model for both.
- Exploration, per-source caps and dedupe follow discovery-research.md.

## 6. Phased rollout, risks, open questions

### Phases

1. **Foundation + find similar (M, about 1–2 days).**
   - The `itemEmbeddings` table and vector index.
   - `embedImage` and `embedText`, wired into `preprocessItem`,
     `repaletteItem` and `tagTextItem`, with cascade delete in
     `items.remove`.
   - Migration 014, which is the same function as `embedMissing`.
   - The "More like this" strip in the modal.
   - Check the near-duplicate score distribution, to calibrate a threshold
     for the chosen model.
2. **Hybrid search (M).** `searchSemantic` plus RRF in the search page,
   with progressive merging.
3. **Map + clusters + names (L).** This replaces `/atlas`:
   - the `mapLayouts` document, the nightly cron and Procrustes alignment;
   - the canvas UI;
   - cluster naming.
4. **Drift (S)** on top of phase 3.
5. **Feed ranking (M)**, inside the discovery project. It reuses the
   phase-3 centroids.

Phase 1 is a prerequisite for everything else. Phases 2 and 3 are
independent of each other.

### Risks

- **Vendor change means re-embedding.** No two models' vectors mix; that
  includes Gemini generations 001 → 2. It's mitigated by cost (about $1
  per 10k) and by the `model` filter field, which allows a zero-downtime
  swap. EmbeddingGemma 2's open weights remove the vendor risk: if one
  host goes away, the same model runs on the other (Cloudflare or
  DeepInfra) or on Modal, and the vectors stay valid, provided the parity
  check passes.
- **A new, young model path.** EmbeddingGemma 2 is a month old, and
  Cloudflare has served it for two days. Verify that hosted and local
  vectors match before building. Measure query latency, which neither host
  documents; it needs to be under about 0.5 s. Gemini via OpenRouter is
  the drop-in fallback.
- **Score calibration.** Both picks have a narrow cosine band, so absolute
  thresholds are brittle. Prefer ranks (RRF, top-k) over thresholds everywhere.
- **Small library.** At 93 items, clusters and drift are noisy, and
  "similar" sometimes returns the only five vaguely related items. That's
  fine, but don't over-tune on today's data.
- **The modality gap.** Text-vector items (articles) form their own region
  of the space. Either show them on the map as their own island, or leave
  them off the map.
- **Multi-user query cost.** Every `vectorSearch` bills the whole shared
  index. This is negligible for friends, but it's why feed scoring should
  use centroids.

### Open questions for you

1. **~~EmbeddingGemma 2 or Gemini?~~ Decided 2026-11-14: EmbeddingGemma 2**
   (see Decision at the top). The original framing: Quality was close: about 31 vs 28 query hits. Gemini needs
   no new key and has more track record. EmbeddingGemma 2 is open-weight
   (no lock-in) and about 20× cheaper. The decision turns on whether you'd
   rather add a DeepInfra key or depend on a closed Google model. (Host
   later moved to Cloudflare, which needs no new vendor.)
   Self-hosting SigLIP isn't worth a second service.
2. **Should articles be on the map?** They're the text-vector island.
   The options: their own region, a separate "reading" map, or excluded.
3. **Second text vector (`semanticText`) per item now or later?** I
   recommend later, once hybrid search shows where lexical+image misses.
4. **Which Convex plan is prod on?** Everything here fits Free. The only
   line that gets close is database I/O, and that's because `items.list`
   collects the whole table on every change (about 170 KB per read today),
   not because of embeddings. Worth knowing before the discovery feed
   multiplies writes.
