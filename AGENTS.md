# re-collect

## Overview

A personal web application for collecting, organizing, and rediscovering design inspiration, web screenshots, articles, and visual references. Similar to Are.na.

## Core User Flows

### Adding Items

- Multi-purpose input box
- When URL is pasted or typed:
  - Automatically extract page title
  - Generate a screenshot of the webpage
- When image is uploaded/pasted:
  - Accept the image as-is
  - Use the title of the image file
- When text is typed:
  - Use the text as primary content

- Besides their primary content type, items can also have:
  - Title
  - URL (if not already set)
  - Description
  - Collections they're attached to
  - Date added/modified

### Organizing Items

- **Collections**: Named groups of items
  - Create, edit, delete collections
  - Add items to multiple collections simultaneously
  - Each collection has optional description
- **Manual ordering**: Drag and drop to reorder items within a collection
- **Sorting options**:
  - Manual order (default, respects drag-drop)
  - Date added (newest/oldest)
  - Date modified (newest/oldest)
  - Alphabetical by title

### Browsing & Viewing

- **Primary view**: Masonry/grid layout
  - Show images prominently for visual items
  - Show text or url in a card format for non-visual items
  - Hover/tap to see item details without leaving grid
- **List view**: Alternative compact view
  - Shows title, small image, URL, date in rows
  - Better for text-heavy collections
- **Individual item view**:
  - Full-size image (if present)
  - Complete title, description, URL
  - All collections displayed
  - Edit/delete controls
  - Metadata (date added, date modified)

### Searching

- **Search bar** that searches across:
  - Item titles
  - Descriptions/notes
  - Tags
  - URLs
- Search should be fast and feel instant
- Results highlight matching terms=

## Key Features (Priority Order)

### MVP (Must Have)

1. Add items via input box (paste URL, upload image, type text)
2. Edit item details
3. Delete items
4. Create and manage collections
5. Add items to multiple collections
6. Masonry grid view
7. Basic search across titles and descriptions
8. Delete items
9. Manual reordering within collections

### Phase 2 (Nice to Have)

1. Automatic screenshot generation for URL items
2. Multiple sort options (date, alphabetical)
3. Keyboard shortcuts (especially for quick add)
4. List and item views
5. Bulk operations and multi-select
6. Mobile-optimized interface

### Phase 3 (Future)

1. Browser extension for one-click saving
2. PWA support

### Non-Requirements (Out of Scope)

- Multi-user support / collaboration
- Social features
- AI-powered anything (keep it simple initially)
- Authentication/login (single user, personal use)

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
