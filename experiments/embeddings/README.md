# Embedding benchmark (throwaway)

Sanity check for `reference/embeddings-research.md`. Embeds every library
item with several models and compares text→image query hits, item→item
neighbours and a tag-overlap proxy. Not wired into the app.

```bash
S=/some/scratch/dir
npx convex data items --prod --limit 10000 --format jsonLines > $S/items.jsonl   # read-only
export OPENROUTER_API_KEY=… R2_PUBLIC_URL=…
uv run bench.py embed  $S/items.jsonl $S/bench    # Gemini / Voyage / Cohere / tag-text via OpenRouter (~7¢ for 93 items)
uv run siglip.py       $S/items.jsonl $S/bench    # local SigLIP 2 base
uv run siglip.py       $S/items.jsonl $S/bench google/siglip2-so400m-patch14-384
uv run gemma.py        $S/items.jsonl $S/bench    # local EmbeddingGemma 2
uv run bench.py report $S/items.jsonl $S/bench    # metrics + contact sheets in $S/bench/sheets
uv run qwen.py         $S/items.jsonl $S/bench    # local Qwen3-VL-Embedding-2B (bf16, ~6 GB)
uv run h2h.py sheets   $S/items.jsonl $S/bench derived-gemini-768 local-embeddinggemma-2   # blind A/B sheets
uv run h2h.py tally    $S/bench verdicts.json
```

Images and vectors stay in the scratch dir; nothing user-owned is committed.
Results are summarised in §1 of the research doc.
