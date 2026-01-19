import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { deleteAllPositionsForCollection } from './itemCollectionPositions';

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

// Get collection with item count
export const listWithCounts = query({
	args: {},
	handler: async (ctx) => {
		const collections = await ctx.db.query('collections').order('desc').collect();

		const countsMap = new Map();

		for (const collection of collections) {
			const positions = await ctx.db
				.query('itemCollectionPositions')
				.withIndex('by_collection', (q) => q.eq('collectionId', collection._id))
				.collect();
			countsMap.set(collection._id, positions.length);
		}

		return collections.map((collection) => ({
			...collection,
			itemCount: countsMap.get(collection._id) ?? 0
		}));
	}
});
