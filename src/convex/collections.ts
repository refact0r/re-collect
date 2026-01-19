import { v } from 'convex/values';
import { mutation, query, type QueryCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { deleteAllPositionsForCollection } from './itemCollectionPositions';
import { getImageUrl } from './items';

// Create a new collection
export const create = mutation({
	args: {
		name: v.string()
	},
	handler: async (ctx, args) => {
		return await ctx.db.insert('collections', {
			name: args.name,
			dateCreated: Date.now()
		});
	}
});

// Update a collection
export const update = mutation({
	args: {
		id: v.id('collections'),
		name: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const { id, ...updates } = args;
		const existing = await ctx.db.get(id);
		if (!existing) throw new Error('Collection not found');

		await ctx.db.patch(id, updates);
	}
});

// Delete a collection (also removes it from all items)
export const remove = mutation({
	args: { id: v.id('collections') },
	handler: async (ctx, args) => {
		const collection = await ctx.db.get(args.id);
		if (!collection) throw new Error('Collection not found');

		// Delete all position records for this collection
		await deleteAllPositionsForCollection(ctx, args.id);

		// Remove this collection from all items that reference it
		// Use the junction table index to find only items in this collection
		const positions = await ctx.db
			.query('itemCollectionPositions')
			.withIndex('by_collection', (q) => q.eq('collectionId', args.id))
			.collect();

		for (const position of positions) {
			const item = await ctx.db.get(position.itemId);
			if (item) {
				await ctx.db.patch(item._id, {
					collections: item.collections.filter((c) => c !== args.id)
				});
			}
		}

		await ctx.db.delete(args.id);
	}
});

// Get all collections
export const list = query({
	args: {},
	handler: async (ctx) => {
		return await ctx.db.query('collections').order('desc').collect();
	}
});

// Get a single collection
export const get = query({
	args: { id: v.id('collections') },
	handler: async (ctx, args) => {
		return await ctx.db.get(args.id);
	}
});

// Helper to fetch preview images for a collection
async function getCollectionPreviews(
	ctx: QueryCtx,
	collectionId: Id<'collections'>,
	limit: number = 4
): Promise<Array<{ _id: Id<'items'>; imageUrl: string; type: 'image' | 'url' }>> {
	// Get all items in this collection via itemCollectionPositions
	const positions = await ctx.db
		.query('itemCollectionPositions')
		.withIndex('by_collection', (q) => q.eq('collectionId', collectionId))
		.collect();

	// Fetch items and filter for displayable images
	const items = [];
	for (const position of positions) {
		const item = await ctx.db.get(position.itemId);
		if (!item) continue;

		// Include if: image type with image data, OR url type with completed screenshot
		const hasImage = item.type === 'image' && (item.imageKey || item.imageId);
		const hasScreenshot = item.type === 'url' && item.screenshotStatus === 'completed';

		if (hasImage || hasScreenshot) {
			items.push(item);
		}
	}

	// Sort by dateAdded descending (most recent first)
	items.sort((a, b) => b.dateAdded - a.dateAdded);

	// Take first N items and generate image URLs
	const previews = [];
	for (const item of items.slice(0, limit)) {
		const imageUrl = await getImageUrl(ctx, item);
		if (imageUrl) {
			previews.push({
				_id: item._id,
				imageUrl,
				type: item.type as 'image' | 'url'
			});
		}
	}

	return previews;
}

// Get collection with item count
export const listWithCounts = query({
	args: {},
	handler: async (ctx) => {
		const collections = await ctx.db.query('collections').order('desc').collect();

		const countsMap = new Map();
		const previewsMap = new Map();

		for (const collection of collections) {
			const positions = await ctx.db
				.query('itemCollectionPositions')
				.withIndex('by_collection', (q) => q.eq('collectionId', collection._id))
				.collect();
			countsMap.set(collection._id, positions.length);

			// Fetch preview images
			const previews = await getCollectionPreviews(ctx, collection._id, 4);
			previewsMap.set(collection._id, previews);
		}

		return collections.map((collection) => ({
			...collection,
			itemCount: countsMap.get(collection._id) ?? 0,
			previews: previewsMap.get(collection._id) ?? []
		}));
	}
});
