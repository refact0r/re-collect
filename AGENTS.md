# re-collect

A personal web application for collecting, organizing, and rediscovering design inspiration, web screenshots, articles, and visual references. Similar to Are.na.

Consult `reference/` when working with those systems: `convex-r2.md` (R2 uploads/serving), `icons.md` (icon system), `ops.md` (external configuration, env vars, deploys), `multi-user.md` (user scoping, auth options), `design-tokens.md` (site font extraction), `discovery-research.md` (discovery feed: sources, fetching, ranking; raw notes in `discovery-notes/`), `embeddings-research.md` (embedding model decision, schema/pipeline plan, what embeddings unlock; benchmark scripts in `experiments/embeddings/`), `TODO.md` (future ideas).

`experiments/tagging/` is the sandbox for the AI tagging feature; `architecture.md` there describes the shipped pipeline.

`extension/` is the browser extension (plain JS Manifest V3, no build step); its `README.md` covers loading and configuring it.

## Commands

- `pnpm dev:all` — Convex dev + Vite dev server
- `pnpm check` — svelte-check / type check
- `pnpm test` — vitest (single run)
- `pnpm lint` / `pnpm format` — prettier + eslint
- Deploys are in `reference/ops.md`; `npx convex deploy` targets production

## Development Guidelines

- You OWN the codebase. Do not be afraid to change things.
- Do not excessively preserve backward compatibility, remove obsolete paths and unused code.
- Choose the simplest implementation that works, avoid overengineering.
- Write readable, clean, beautiful code.
- Use SvelteKit and Convex best practices, refer to the documentation if unsure.
- Add comments only when logical/necessary, avoid excessive comments.

## Architecture & Conventions

- **Multi-user, username/password accounts** (see `reference/multi-user.md`): `items`, `collections` and `viewPreferences` carry `userId` and their indexes start with it (`itemCollectionPositions` is reached only through owned rows). Public queries/mutations on user data are defined with `userQuery` / `userMutation` (`src/convex/lib/auth.ts`), which take a `token` arg (the caller's session token) and expose `ctx.userId`; the shared-collection reads use `viewerQuery` instead (optional token, `ctx.viewerId` may be null); the session mutations (`sessions.logout` / `signOutOthers`) and public actions take `token` themselves and check it by hand (`requireUser`, or `api.users.me` from an action). `requireUser` is the one identity seam. Load docs by id with `getOwned` (returns null for anyone else's)
- **Auth is self-hosted, no providers**: `users:invite` mints a one-time signup link (`/login?invite=…`); `sessions.login` / `sessions.signup` (PBKDF2 passwords, lockout after 10 failures) return a session token the SvelteKit server keeps in a one-year cookie and the `(app)` layout passes to the client as `writeToken`; logged-out visitors are redirected to `/login` (by `(app)/+layout.ts`) except on a shared collection
- **Sharing is by link only**: a collection with `shared: true` is viewable read-only by anyone at its own URL (`/collections/[id]`); it's private by default. No profiles, discovery or other social features. Non-owners get only an item's `VISITOR_FIELDS`, with `collections` emptied (`forViewer` in `items.ts`)
- **Item links are http(s) only** (`isWebUrl` in `src/convex/lib/urls.ts`): `items.add` / `update` reject anything else (and a URL item without one), and the UI only links ones that pass (older rows were never checked)
- **Tab title**: the root layout owns the one `<title>`; pages set `pageTitle` (`src/lib/pageTitle.svelte.ts`) in an effect, or return `title` from load for SSR
- **3 item types**: URL (screenshot or og:image via Cloudflare Worker, or a screenshot supplied by the browser extension), image (R2-stored), text
- **Ingestion modes**: `taggingMode` (`visual` / `text` / `none`) and `linkImageMode` (`screenshot` / `og`) are per-collection defaults (home defaults live in `viewPreferences`), snapshotted onto the item at add time
- Items can belong to multiple collections
- **Modal routing**: Items open via `?item=<id>` query param (preserves page context)
- **Context sharing**: Collections and items lists passed down via Svelte context (typed helpers in `src/lib/context.ts`)
- **Manual ordering**: Fractional indexing (lexicographical position strings) — `collections.position` for collections, `itemCollectionPositions` table for items within a collection
- **Collection membership**: `item.collections` (denormalized array), `itemCollectionPositions` (junction table) and `collections.itemCount` must stay in sync — always go through `addItemToCollection` / `removeItemFromCollection` in `itemCollectionPositions.ts`
- **`searchText` is derived**: combined from title + description (user notes) + ogDescription + url + text-item content (capped) + AI-tagging output (subject, styles, aiTags) + paletteNames + font names (`fontSearchTerms` over `items.fonts`); any write to those fields goes through `patchItem(ctx, item, fields)` in `src/convex/lib/searchText.ts` (or sets `searchText: buildSearchText({ ...item, ...fields })` itself); `items:rebuildSearchText` backfills every item after its inputs change
- **`normUrl` is derived too**: `normalizeUrl(url)` (`src/convex/lib/urls.ts`), set by `items.add` / `update` and backfilled by `items:rebuildSearchText`; the `by_user_normUrl` index answers "is this link already saved?": the discovery feed hides saved links, and the add flows (web input, extension) check `items.findByUrl` first and ask before saving a duplicate. `items.add` itself never rejects one
- **Errors**: throw `ConvexError('<short lowercase message>')` for failures a user should read (prod clients only see "Server Error" for a plain `Error`); plain `Error` for internal invariants. `ConvexError('Unauthorized')` means a dead session
- **Prose field ownership**: `description` is user notes (never machine-written), `ogDescription` is captured by the worker or the extension, `subject` is AI-generated; display shows `subject ?? ogDescription`
- **R2 images served via public custom domain** (`R2_PUBLIC_URL` env var): URLs are stable `${R2_PUBLIC_URL}/${imageKey}`, no presigning; R2 keys are immutable, never overwrite one. Image keys reach `items.add` only via the caller's own `uploads` row (minted by `r2.generateUploadUrl`), since deleting an item deletes its object
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
