import { v } from 'convex/values';
import { mutation, query, type QueryCtx } from './_generated/server';
import type { Doc } from './_generated/dataModel';
import { r2 } from './r2';

// Helper to get image URL from either R2 (imageKey) or legacy Convex storage (imageId)
async function getImageUrl(
	ctx: QueryCtx,
	item: Doc<'items'>
): Promise<string | null> {
	if (item.imageKey) {
		return await r2.getUrl(item.imageKey);
	}
	if (item.imageId) {
		return await ctx.storage.getUrl(item.imageId);
	}
	return null;
}

// Add a new item
export const add = mutation({
	args: {
		type: v.union(v.literal('url'), v.literal('image'), v.literal('text')),
		title: v.optional(v.string()),
		description: v.optional(v.string()),
		url: v.optional(v.string()),
		content: v.optional(v.string()),
		imageKey: v.optional(v.string()),
		imageWidth: v.optional(v.number()),
		imageHeight: v.optional(v.number()),
		collections: v.optional(v.array(v.id('collections')))
	},
	handler: async (ctx, args) => {
		const now = Date.now();
		return await ctx.db.insert('items', {
			type: args.type,
			title: args.title,
			description: args.description,
			url: args.url,
			content: args.content,
			imageKey: args.imageKey,
			imageWidth: args.imageWidth,
			imageHeight: args.imageHeight,
			collections: args.collections ?? [],
			dateAdded: now,
			dateModified: now
		});
	}
});

// Update an existing item
export const update = mutation({
	args: {
		id: v.id('items'),
		title: v.optional(v.string()),
		description: v.optional(v.string()),
		url: v.optional(v.string()),
		content: v.optional(v.string()),
		collections: v.optional(v.array(v.id('collections')))
	},
	handler: async (ctx, args) => {
		const { id, ...updates } = args;
		const existing = await ctx.db.get(id);
		if (!existing) throw new Error('Item not found');

		await ctx.db.patch(id, {
			...updates,
			dateModified: Date.now()
		});
	}
});

// Delete an item
export const remove = mutation({
	args: { id: v.id('items') },
	handler: async (ctx, args) => {
		const item = await ctx.db.get(args.id);
		if (!item) throw new Error('Item not found');

		// Delete associated image from R2 or legacy Convex storage
		if (item.imageKey) {
			await r2.deleteObject(ctx, item.imageKey);
		} else if (item.imageId) {
			await ctx.storage.delete(item.imageId);
		}

		await ctx.db.delete(args.id);
	}
});

// Add item to a collection
export const addToCollection = mutation({
	args: {
		itemId: v.id('items'),
		collectionId: v.id('collections')
	},
	handler: async (ctx, args) => {
		const item = await ctx.db.get(args.itemId);
		if (!item) throw new Error('Item not found');

		if (!item.collections.includes(args.collectionId)) {
			await ctx.db.patch(args.itemId, {
				collections: [...item.collections, args.collectionId],
				dateModified: Date.now()
			});
		}
	}
});

// Remove item from a collection
export const removeFromCollection = mutation({
	args: {
		itemId: v.id('items'),
		collectionId: v.id('collections')
	},
	handler: async (ctx, args) => {
		const item = await ctx.db.get(args.itemId);
		if (!item) throw new Error('Item not found');

		await ctx.db.patch(args.itemId, {
			collections: item.collections.filter((c) => c !== args.collectionId),
			dateModified: Date.now()
		});
	}
});

// Get all items
export const list = query({
	args: {},
	handler: async (ctx) => {
		const items = await ctx.db.query('items').order('desc').collect();
		// Get image URLs for items with images
		return Promise.all(
			items.map(async (item) => ({
				...item,
				imageUrl: await getImageUrl(ctx, item)
			}))
		);
	}
});

// Get a single item
export const get = query({
	args: { id: v.id('items') },
	handler: async (ctx, args) => {
		const item = await ctx.db.get(args.id);
		if (!item) return null;
		return {
			...item,
			imageUrl: await getImageUrl(ctx, item)
		};
	}
});

// Get items in a specific collection
export const listByCollection = query({
	args: { collectionId: v.id('collections') },
	handler: async (ctx, args) => {
		const items = await ctx.db.query('items').order('desc').collect();
		const filtered = items.filter((item) => item.collections.includes(args.collectionId));
		return Promise.all(
			filtered.map(async (item) => ({
				...item,
				imageUrl: await getImageUrl(ctx, item)
			}))
		);
	}
});

// Search items by title/description
export const search = query({
	args: { query: v.string() },
	handler: async (ctx, args) => {
		if (!args.query.trim()) {
			return [];
		}
		const results = await ctx.db
			.query('items')
			.withSearchIndex('search_items', (q) => q.search('title', args.query))
			.collect();

		return Promise.all(
			results.map(async (item) => ({
				...item,
				imageUrl: await getImageUrl(ctx, item)
			}))
		);
	}
});
