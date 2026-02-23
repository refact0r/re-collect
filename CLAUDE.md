# re-collect

A personal web application for collecting, organizing, and rediscovering design inspiration, web screenshots, articles, and visual references. Similar to Are.na.

Consult `/reference` docs (R2 integration, Convex setup, icon system) when working with those systems.

## Architecture & Conventions

- Single-user app - no auth, no multi-user, no social/AI features
- **3 item types**: URL (auto-screenshots via Cloudflare Worker), image (R2-stored), text
- Items can belong to multiple collections
- **Modal routing**: Items open via `?item=<id>` query param (preserves page context)
- **Context sharing**: Collections and items lists passed down via Svelte context
- **Manual ordering**: Fractional indexing (lexicographical position strings) in `itemCollectionPositions` table
- **`searchText` is derived**: combined from title + description + url; must be updated on any write that changes those fields
- **R2 presigned URLs change every fetch**: `imageCache` caches by itemId to prevent reload, always use `getImage()` from `imageCache.svelte.ts`
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
