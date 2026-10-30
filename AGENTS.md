# re-collect

A personal web application for collecting, organizing, and rediscovering design inspiration, web screenshots, articles, and visual references. Similar to Are.na.

Consult `reference/` when working with those systems: `convex-r2.md` (R2 uploads/serving), `icons.md` (icon system), `ops.md` (external configuration, env vars, deploys), `TODO.md` (future ideas).

`experiments/tagging/` is the sandbox for the AI tagging feature; `architecture.md` there describes the shipped pipeline.

## Commands

- `pnpm dev:all` — Convex dev + Vite dev server
- `pnpm check` — svelte-check / type check
- `pnpm test` — vitest (single run)
- `pnpm lint` / `pnpm format` — prettier + eslint
- Deploys are in `reference/ops.md`; `npx convex deploy` targets production

## Development Guidelines

- Do not excessively preserve backward compatibility, remove obsolete paths and unused code.
- Choose the simplest implementation that works, avoid overengineering.
- Write readable, clean, beautiful code.
- Use SvelteKit and Convex best practices, refer to the documentation if unsure.
- Add comments only when logical/necessary, avoid excessive comments.

## Architecture & Conventions

- Single-user app - no multi-user or social features. Auth is a single password cookie gate (`AUTH_PASSWORD`) plus a `CONVEX_WRITE_TOKEN`; public mutations are defined with `authedMutation` (`src/convex/lib/auth.ts`), which adds and checks the `token` arg
- **3 item types**: URL (screenshot or og:image via Cloudflare Worker), image (R2-stored), text
- **Ingestion modes**: `taggingMode` (`visual` / `text` / `none`) and `linkImageMode` (`screenshot` / `og`) are per-collection defaults (home defaults live in `viewPreferences`), snapshotted onto the item at add time
- Items can belong to multiple collections
- **Modal routing**: Items open via `?item=<id>` query param (preserves page context)
- **Context sharing**: Collections and items lists passed down via Svelte context (typed helpers in `src/lib/context.ts`)
- **Manual ordering**: Fractional indexing (lexicographical position strings) — `collections.position` for collections, `itemCollectionPositions` table for items within a collection
- **Collection membership**: `item.collections` (denormalized array), `itemCollectionPositions` (junction table) and `collections.itemCount` must stay in sync — always go through `addItemToCollection` / `removeItemFromCollection` in `itemCollectionPositions.ts`
- **`searchText` is derived**: combined from title + description (user notes) + ogDescription + url + AI-tagging output (subject, styles, aiTags) + paletteNames; rebuild via `buildSearchText()` in `src/convex/lib/searchText.ts` on any write that changes those fields
- **Prose field ownership**: `description` is user notes (never machine-written), `ogDescription` is worker-captured, `subject` is AI-generated; display shows `subject ?? ogDescription`
- **R2 images served via public custom domain** (`R2_PUBLIC_URL` env var): URLs are stable `${R2_PUBLIC_URL}/${imageKey}`, no presigning; R2 keys are immutable, never overwrite one
- Svelte 5 only - do not use deprecated Svelte features
- Use global styles/colors from `app.css` (`--bg-*`, `--txt-*`); prefer scoped styles over inline

## Svelte MCP

The Svelte MCP server provides Svelte 5 / SvelteKit docs and a code checker:

- `list-sections` → `get-documentation`: look up the relevant docs sections when unsure about a Svelte or SvelteKit API.
- `svelte-autofixer`: run on any Svelte code you write, and repeat until it reports no issues or suggestions.

## Convex Guidelines

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`src/convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->
