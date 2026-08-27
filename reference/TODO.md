# TODO / future plans

Next steps and ideas, mostly from the ingestion-modes work (per-collection
tagging + link-image defaults, og:image capture). Not a roadmap — prune freely.

## Content enrichment

- **Textual tagging mode for links** (`taggingMode: 'text'`): articles get an
  LLM summary (→ `subject`) and topic tags (→ `aiTags`) instead of visual style
  tagging. Pipeline: extract readable article text (Readability in the worker,
  or from the fetched HTML), truncate to ~6–8k chars, cheap LLM call, reuse the
  existing validation/normalization + `searchText` plumbing. The mode option UI
  is already shaped to take a third value.
- **Manual tags**: user-editable `tags: string[]` on items, folded into
  `searchText`. Also the natural correction when AI tags are close-but-wrong.
- **Duplicate detection on paste**: on add, look up an existing item with the
  same normalized URL and offer "already saved in X — add to this collection"
  instead of creating a twin.
- **Remove-tags control**: clear `styles`/`subject`/`aiTags` on an item
  (must rebuild `searchText`); keep the palette.

## Other improvements

- Paginate things to improve performance
