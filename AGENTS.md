# re-collect

A personal web application for collecting, organizing, and rediscovering design inspiration, web screenshots, articles, and visual references. Similar to Are.na.

## Project Structure

```
src/
├── routes/                          # SvelteKit routes (file-based routing)
│   ├── +layout.svelte              # Root layout with sidebar
│   ├── +page.svelte                # Home page (all items)
│   ├── collections/                # Collections routes
│   │   └── [id]/                   # Individual collection page
│   ├── item/[id]/                  # Individual item detail page
│   └── search/                     # Search results page
│
├── lib/
│   ├── components/                 # Reusable Svelte components
│   │   ├── ItemGrid.svelte        # Main masonry grid display
│   │   ├── ItemInput.svelte       # Input box for adding items
│   │   ├── ItemEditor.svelte      # Edit item details
│   │   ├── ItemModal.svelte       # Item detail modal
│   │   ├── Sidebar.svelte         # Navigation sidebar
│   │   └── CollectionCreateModal.svelte
│   ├── imageCache.svelte.ts       # Global client-side image caching
│   └── assets/                    # Static assets
│
├── convex/                         # Convex backend (database + API)
│   ├── schema.ts                  # Database schema definition
│   ├── items.ts                   # Item CRUD operations
│   ├── collections.ts             # Collection operations
│   ├── itemCollectionPositions.ts # Manual ordering logic
│   ├── screenshots.ts             # Screenshot generation integration
│   └── r2.ts                      # Cloudflare R2 storage config
│
├── app.css                        # Global styles & CSS variables
│                                  # (--bg-*, --txt-* color scheme)
└── app.html                       # HTML template

workers/screenshot/                 # Cloudflare Worker for screenshots
└── src/                           # Screenshot generation logic
```

## Reference Documentation

The `/reference` folder contains technical documentation for maintaining the codebase:

- `convex-r2.md` - Cloudflare R2 integration with Convex
- `convex-setup.md` - Convex backend setup and configuration
- `icons.md` - Icon system usage (unplugin-icons with Material Symbols Sharp)

These docs are maintained for context and should be consulted when working with their respective systems.

## Core User Flows

### Adding Items

- Multi-purpose input box supporting 3 item types: **URL**, **image**, **text**
- All items have: title, description, url, collections, timestamps (added/modified)
- URL items automatically generate screenshots with status tracking

### Organizing Items

- **Collections**: Named groups of items with item counts
  - Create, rename, delete collections
  - Add items to multiple collections
- **Manual ordering**: Drag-drop reordering within collections (manual sort mode only)
- **Sorting options** (per-collection):
  - Manual (default, respects drag-drop order)
  - Date added (newest/oldest first)
  - Date modified (newest/oldest first)
  - Title (A-Z / Z-A)

### Browsing & Viewing

- **Masonry grid**: Responsive multi-column layout with auto-balancing
  - Images display with proper aspect ratios
  - URL items show screenshot (when available) or placeholder with status
  - Text items show content preview (max 10 lines)
  - Click any item to open modal editor
- **Item modal**: Full-screen editor with keyboard navigation
  - Arrow keys navigate between items
  - Edit title, description, URL, content
  - Toggle collection membership
  - Delete item

### Searching

- Search by **item title only** (full-text search via Convex)
- Results displayed in masonry grid
- Debounced live search with URL sync

## Roadmap

### Planned Features

- Expand/improve search to include descriptions and URLs (not just titles)
- List view (alternative to masonry grid)
- Keyboard shortcuts (quick add, navigation)
- Bulk operations and multi-select
- Mobile-optimized interface
- Improved styling and transitions/animations
- Browser extension for one-click saving
- PWA support

### Out of Scope (for now)

- Multi-user support / collaboration
- Social features
- AI-powered features
- Authentication/login (single-user, personal use)

## Development Guidelines

### Svelte & SvelteKit

- Use Svelte 5 and SvelteKit conventions
- DO NOT use deprecated Svelte features

### CSS & Styling

- Write simple, minimal CSS
- Use global styles from app.css whenever possible
- Use existing colors (--bg-x, --txt-x) for consistency
- Avoid inline styles; prefer scoped component styles

### Architectural Patterns

- **Modal routing**: Items open via ?item=<id> query param (preserves page context)
- **Context sharing**: Collections and items lists passed down via Svelte context
- **Manual ordering**: Fractional indexing (lexicographical position strings) in itemCollectionPositions table
- **Image storage**: Cloudflare R2 (imageKey field)

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
