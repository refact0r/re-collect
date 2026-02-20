import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
	items: defineTable({
		type: v.union(v.literal('url'), v.literal('image'), v.literal('text')),
		title: v.optional(v.string()),
		description: v.optional(v.string()),
		url: v.optional(v.string()),
		content: v.optional(v.string()), // For text items
		imageKey: v.optional(v.string()), // R2 object key for uploaded images
		imageId: v.optional(v.id('_storage')), // Legacy: Convex storage ID (deprecated)
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
		screenshotRetries: v.optional(v.number()), // Track retry attempts
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
		viewMode: v.optional(v.union(v.literal('grid'), v.literal('list'))) // Defaults to 'grid'
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
		filterCollectionIds: v.optional(v.array(v.id('collections')))
	}).index('by_key', ['key']),

	// Junction table for per-collection item ordering
	itemCollectionPositions: defineTable({
		itemId: v.id('items'),
		collectionId: v.id('collections'),
		position: v.string(), // Lexicographical: "a", "aM", "b", etc.
		dateAdded: v.number()
	})
		.index('by_collection', ['collectionId', 'position'])
		.index('by_item', ['itemId'])
		.index('by_item_and_collection', ['itemId', 'collectionId'])
});
