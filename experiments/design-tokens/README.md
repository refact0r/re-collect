# Design-token extraction prototype

Throwaway. Findings and the v1 proposal are in `reference/design-tokens.md`.

```bash
npm install          # puppeteer-core, uses the system Chrome
node run.mjs urls.txt 5
node summarize.mjs > out/summary.txt
```

- `extract.js`: browser-side extractor (self-contained, passed to `page.evaluate`)
- `run.mjs`: loads pages like `workers/screenshot` does, times extraction, asks Chromium (CDP) which fonts actually rendered
- `out/results.json`, `out/summary.txt`: the 2026-11-12 run over 40 sites (screenshots are gitignored)

Still in use:

- `check-worker.mjs`: runs the worker's real font code against `urls.txt` in local Chrome.
- `backfill.mjs [--prod] [--all]`: fills `items.fonts` for URL items from local Chrome (no Browser Run quota) via `screenshots:setFonts`. Results are saved to `out/backfill-<deployment>.json`.
