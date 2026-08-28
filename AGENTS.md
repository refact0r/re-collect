# re-collect

A personal web application for collecting, organizing, and rediscovering design inspiration, web screenshots, articles, and visual references. Similar to Are.na.

Consult `/reference` docs (R2 integration, icon system) when working with those systems. `reference/ops.md` documents external configuration.

`experiments/tagging/` is the sandbox for the AI image-tagging feature.

## Development Guidelines

- Do not excessively preserve backward compatibility, remove obsolte paths and unused code.
- Choose the simplest implementation that works, avoid overengineering.
- Use SvelteKit and Convex best practices, refer to the documentation if unsure.
- Add comments only when logical/necessary, avoid excessive comments.

## Architecture & Conventions

- Single-user app - no multi-user or social features. Auth is a single password cookie gate (`AUTH_PASSWORD`) plus a `CONVEX_WRITE_TOKEN` checked by mutations via `requireAuth`
- **3 item types**: URL (auto-screenshots via Cloudflare Worker), image (R2-stored), text
- Items can belong to multiple collections
- **Modal routing**: Items open via `?item=<id>` query param (preserves page context)
- **Context sharing**: Collections and items lists passed down via Svelte context
- **Manual ordering**: Fractional indexing (lexicographical position strings) in `itemCollectionPositions` table
- **`searchText` is derived**: combined from title + description (user notes) + ogDescription + url + AI-tagging output (subject, styles, aiTags); rebuild via `buildSearchText()` in `searchText.ts` on any write that changes those fields
- **Prose field ownership**: `description` is user notes (never machine-written), `ogDescription` is worker-captured, `subject` is AI-generated; display shows `subject ?? ogDescription`
- **R2 images served via public custom domain** (`R2_PUBLIC_URL` env var): URLs are stable `${R2_PUBLIC_URL}/${imageKey}`, no presigning
- **Dual collection bookkeeping**: `item.collections` (denormalized array) and `itemCollectionPositions` (junction table for ordering) must both be updated when adding/removing items from collections
- Svelte 5 only - do not use deprecated Svelte features
- Use global styles/colors from `app.css` (`--bg-*`, `--txt-*`); prefer scoped styles over inline

## Svelte MCP

You are able to use the Svelte MCP server, where you have access to comprehensive Svelte 5 and SvelteKit documentation. Here's how to use the available tools effectively:

### 1. list-sections

Use this FIRST to discover all available documentation sections. Returns a structured list with titles, use_cases, and paths.
When asked about Svelte or SvelteKit topics, ALWAYS use this tool at the start of the chat to find relevant sections.

### 2. get-documentation

Retrieves full documentation content for specific sections. Accepts single or multiple sections.
After calling the list-sections tool, you MUST analyze the returned documentation sections (especially the use_cases field) and then use the get-documentation tool to fetch ALL documentation sections that are relevant for the user's task.

### 3. svelte-autofixer

Analyzes Svelte code and returns issues and suggestions.
You MUST use this tool whenever writing Svelte code before sending it to the user. Keep calling it until no issues or suggestions are returned.

### 4. playground-link

Generates a Svelte Playground link with the provided code.
After completing the code, ask the user if they want a playground link. Only call this tool after user confirmation and NEVER if code was written to files in their project.

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
