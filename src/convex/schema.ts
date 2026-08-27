import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

// Ingestion mode validators, shared by every table/mutation that stores them.
// undefined always means the default: 'visual' / 'screenshot'.
export const taggingModeValidator = v.union(v.literal('visual'), v.literal('none'));
export const linkImageModeValidator = v.union(v.literal('screenshot'), v.literal('og'));

export default defineSchema({
	items: defineTable({
		type: v.union(v.literal('url'), v.literal('image'), v.literal('text')),
		title: v.optional(v.string()),
		description: v.optional(v.string()),
		url: v.optional(v.string()),
		content: v.optional(v.string()), // For text items
		imageKey: v.optional(v.string()), // R2 object key for uploaded images
		imageWidth: v.optional(v.number()), // Image dimensions for masonry layout
		imageHeight: v.optional(v.number()),
		// Screenshot generation status for URL items
		screenshotStatus: v.optional(
			v.union(
				v.literal('pending'),
				v.literal('processing'),
				v.literal('completed'),
				v.literal('failed')
			)
		),
		screenshotError: v.optional(v.string()),
		// LLM tagger output
		styles: v.optional(v.array(v.string())),
		subject: v.optional(v.string()),
		aiTags: v.optional(v.array(v.string())),
		// Deterministic palette extracted from pixels (not LLM)
		paletteHex: v.optional(v.array(v.string())),
		// Named-color tokens derived from paletteHex via Lab nearest-neighbor;
		// included in searchText so queries like "blue poster" hit color matches.
		paletteNames: v.optional(v.array(v.string())),
		// Tagging status tracking
		taggingStatus: v.optional(
			v.union(
				v.literal('pending'),
				v.literal('processing'),
				v.literal('completed'),
				v.literal('failed')
			)
		),
		taggingError: v.optional(v.string()),
		taggingModelVersion: v.optional(v.string()),
		// Ingestion prefs snapshotted from the first collection at add time
		taggingMode: v.optional(taggingModeValidator),
		linkImageMode: v.optional(linkImageModeValidator), // URL items only
		searchText: v.optional(v.string()), // Combined field for full-text search (title + description + url)
		collections: v.array(v.id('collections')),
		dateAdded: v.number(),
		dateModified: v.number()
	})
		.index('by_dateAdded', ['dateAdded'])
		.index('by_dateModified', ['dateModified'])
		.searchIndex('search_items', {
			searchField: 'searchText',
			filterFields: ['collections']
		}),

	collections: defineTable({
		name: v.string(),
		dateCreated: v.number(),
		position: v.optional(v.string()), // Lexicographical fractional index for manual ordering
		itemCount: v.optional(v.number()), // Denormalized count of itemCollectionPositions rows (backfilled by migration 011)
		sortMode: v.optional(
			v.union(
				v.literal('manual'),
				v.literal('dateAddedNewest'),
				v.literal('dateAddedOldest'),
				v.literal('dateModifiedNewest'),
				v.literal('dateModifiedOldest'),
				v.literal('titleAsc'),
				v.literal('titleDesc')
			)
		), // Defaults to 'manual'
		viewMode: v.optional(v.union(v.literal('grid'), v.literal('list'))), // Defaults to 'grid'
		// Ingestion defaults applied to items added into this collection
		taggingMode: v.optional(taggingModeValidator),
		linkImageMode: v.optional(linkImageModeValidator)
	}).index('by_name', ['name']),

	// View preferences for non-collection pages (home, search)
	viewPreferences: defineTable({
		key: v.string(), // "home", "search"
		sortMode: v.optional(
			v.union(
				v.literal('dateAddedNewest'),
				v.literal('dateAddedOldest'),
				v.literal('dateModifiedNewest'),
				v.literal('dateModifiedOldest'),
				v.literal('titleAsc'),
				v.literal('titleDesc')
			)
		),
		viewMode: v.optional(v.union(v.literal('grid'), v.literal('list'))),
		filterCollectionIds: v.optional(v.array(v.id('collections'))),
		includeUncollected: v.optional(v.boolean()),
		// Ingestion defaults for collection-less adds (stored on the "home" row)
		taggingMode: v.optional(taggingModeValidator),
		linkImageMode: v.optional(linkImageModeValidator)
	}).index('by_key', ['key']),

	// Junction table for per-collection item ordering
	itemCollectionPositions: defineTable({
		itemId: v.id('items'),
		collectionId: v.id('collections'),
		position: v.string(), // Lexicographical: "a", "aM", "b", etc.
		dateAdded: v.number()
	})
		.index('by_collection', ['collectionId', 'position'])
		.index('by_collection_dateAdded', ['collectionId', 'dateAdded'])
		.index('by_item', ['itemId'])
		.index('by_item_and_collection', ['itemId', 'collectionId'])
});
