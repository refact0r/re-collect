# AI Tagging — Design Notes

Pre-implementation notes for the AI image tagging feature prototyped in this
directory. Captures the product framing and the search/similarity architecture
agreed on before prompt-level iteration began.

## Product framing

Tagging is layered, with each tier adding more UI surface and more curation
burden. We are not committing to all tiers upfront.

- **Tier 1 — invisible substrate.** LLM output folds into the search corpus.
  Image items today have nothing searchable; this alone is the biggest unlock.
  No new UI.
- **Tier 2 — light surfacing.** "More like this" on the item modal, style
  filter chips inside search results, suggested collections. Tags operate on
  populations or similarity, not as ground-truth labels.
- **Tier 3 — tags as first-class UI.** Browseable `/tags` index, click-to-filter
  chips on the item modal. This is in scope because of the vocabulary-discovery
  goal below.

**Core motivation.** Tags are not just a search aid — they are a tool for the
user to learn the vocabulary of the genres they're drawn to. Frequencies and
distinct labels are the signal. The /tags page is the centerpiece of this
goal.

**No manual tagging.** Tags are model-owned. The escape hatches are a
"regenerate tags" button on the item, and possibly a "hide tag" affordance
later. No add/edit of arbitrary tags. The model is framed as a perspective on
the library, not a librarian — occasional weird tags are part of the texture.

This raises the bar on tag quality, since bad tags will be visible and
uneditable. Worth a wider evaluation pass before committing.

## LLM tagger output

Five fields per item (layout dropped, folded into styles):

| Field    | Type     | Role                                                |
| -------- | -------- | --------------------------------------------------- |
| kind     | enum     | Structured filter (`artwork`, `graphic_design`, `website`, `photograph`, `other`) — not search input. |
| styles   | string[] | Primary categorical labels. Aesthetic / genre / movement. May absorb composition descriptors ("swiss grid", "broken grid"). |
| palette  | string   | Short phrase ("muted earth tones", "neon CMYK"). LLM is good at color words, bad at hex. |
| subject  | string   | One sentence of literal content. Kept conditionally — see open questions. |
| tags     | string[] | 5-12 concrete observations: specific objects, materials, motifs, technical details. Distinct from styles. |

Layout was dropped because:

- Output was inconsistent (sometimes a tight label, sometimes a sentence
  that duplicated subject).
- The useful layout descriptors are aesthetic labels of the same kind as
  styles; no principled reason to split them.
- One less field to maintain, one less source of duplication.

## Palette: hybrid

Two-part palette, split by what each tool is good at:

- **Hex values** — deterministic extraction (k-means / median-cut, e.g.
  `node-vibrant`) during the same image preprocessing that downscales for the
  LLM. Reliable, cheap, accurate. LLMs hallucinate hex codes; do not trust
  them.
- **Palette description string** — LLM-generated. Powers word-based color
  search ("blue", "dark", "muted earth tones").

Use cases this serves: color-word search (description), palette swatch display
on the item modal (hex). Item-to-item color similarity is a distant third and
skipped for now.

## Similarity: embeddings, not LLM tags

For "more like this" / clustering / item-to-item similarity, the right tool
is an image embedding model (CLIP, SigLIP, etc.), not the LLM tags.

- LLM tags = discrete, browseable, search-friendly.
- Image embeddings = continuous, good for similarity, useless for browsing.

They are complementary, not competing. Convex has vector search built in, so
an `embedding` column on items is cheap to add.

## Search architecture

Two text columns plus structured filters. Avoids forcing one pipeline to do
everything.

### `searchText` — lexical index (existing)

For "I remember the literal words" recall and chip-click exact filtering.
Contains:

- title
- user description
- url
- raw style labels
- raw tag labels

Click-a-chip = exact filter on this column.

### `semanticText` — embedded for vector search (new)

For "find me the vibe" typed queries. Contains:

- title
- user description
- styles
- palette description
- subject (if kept)
- tags

URLs deliberately excluded — they tokenize badly and add noise.

### Structured filters

- `kind` — five enum values, a toggle, not search input.
- `collections` — already a filter, unchanged.

### Query strategy

- **Typed search** → hybrid: lexical pass first (predictable, exact matches
  almost always indicate intent), vector pass appended for semantic neighbors.
- **Chip click** → exact filter via the lexical column. No fuzziness.
- **/tags index** → all distinct tags with frequencies. No auto-collapsing of
  near-duplicates like "y2k" vs "early 2000s web" — the distinct vocabulary is
  the point of the page.

Operational note: any write that changes title/description/url/tags must
update both columns. Re-embedding has a small per-item cost; batch on
re-tagging.

## Open questions

- **Keep `subject`?** Content-wise it's redundant with `tags`. The sentence
  form earns its keep only if alt text, a caption display on the item modal,
  or improved semantic-embedding input are on the roadmap. Default to drop if
  none of those land.
- **Tag quality bar.** Given no manual editing, what failure rate is
  acceptable? Worth a larger eval before shipping the visible /tags surface.
- **Re-tagging cadence.** When is automatic re-tagging triggered? Manual
  button only, or also on prompt/model upgrades?
