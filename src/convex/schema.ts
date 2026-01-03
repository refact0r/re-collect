import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
	items: defineTable({
		type: v.union(v.literal('url'), v.literal('image'), v.literal('text')),
		title: v.optional(v.string()),
		description: v.optional(v.string()),
		url: v.optional(v.string()),
		content: v.optional(v.string()), // For text items
		imageId: v.optional(v.id('_storage')), // For uploaded images
		collections: v.array(v.id('collections')),
		dateAdded: v.number(),
		dateModified: v.number()
	})
		.index('by_dateAdded', ['dateAdded'])
		.index('by_dateModified', ['dateModified'])
		.searchIndex('search_items', {
			searchField: 'title',
			filterFields: ['collections']
		}),

	collections: defineTable({
		name: v.string(),
		description: v.optional(v.string()),
		dateCreated: v.number()
	}).index('by_name', ['name'])
});
