import { v } from 'convex/values';
import { mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { generateKeyBetween } from 'fractional-indexing';
import { requireAuth } from './auth';

// Get position record for an item in a collection
export async function getPositionRecord(
	ctx: QueryCtx,
	itemId: Id<'items'>,
	collectionId: Id<'collections'>
) {
	return await ctx.db
		.query('itemCollectionPositions')
		.withIndex('by_item_and_collection', (q) =>
			q.eq('itemId', itemId).eq('collectionId', collectionId)
		)
		.unique();
}

// Get the first (topmost) position in a collection
export async function getFirstPosition(ctx: QueryCtx, collectionId: Id<'collections'>) {
	const first = await ctx.db
		.query('itemCollectionPositions')
		.withIndex('by_collection', (q) => q.eq('collectionId', collectionId))
		.first();
	return first?.position ?? null;
}

// Get all position records for a collection, ordered by position
export async function getPositionsByCollection(ctx: QueryCtx, collectionId: Id<'collections'>) {
	return await ctx.db
		.query('itemCollectionPositions')
		.withIndex('by_collection', (q) => q.eq('collectionId', collectionId))
		.collect();
}

// Add item to collection with a position (at the top by default)
export async function addItemToCollectionWithPosition(
	ctx: MutationCtx,
	itemId: Id<'items'>,
	collectionId: Id<'collections'>,
	position?: string
) {
	// Check if position record already exists
	const existing = await ctx.db
		.query('itemCollectionPositions')
		.withIndex('by_item_and_collection', (q) =>
			q.eq('itemId', itemId).eq('collectionId', collectionId)
		)
		.unique();

	if (existing) {
		return existing._id;
	}

	// If no position provided, add at the top
	let newPosition = position;
	if (!newPosition) {
		const firstPos = await getFirstPosition(ctx, collectionId);
		newPosition = generateKeyBetween(null, firstPos);
	}

	return await ctx.db.insert('itemCollectionPositions', {
		itemId,
		collectionId,
		position: newPosition,
		dateAdded: Date.now()
	});
}

// Remove item from collection (delete position record)
export async function removeItemFromCollectionWithPosition(
	ctx: MutationCtx,
	itemId: Id<'items'>,
	collectionId: Id<'collections'>
) {
	const record = await ctx.db
		.query('itemCollectionPositions')
		.withIndex('by_item_and_collection', (q) =>
			q.eq('itemId', itemId).eq('collectionId', collectionId)
		)
		.unique();

	if (record) {
		await ctx.db.delete(record._id);
	}
}

// Delete all position records for an item
export async function deleteAllPositionsForItem(ctx: MutationCtx, itemId: Id<'items'>) {
	const records = await ctx.db
		.query('itemCollectionPositions')
		.withIndex('by_item', (q) => q.eq('itemId', itemId))
		.collect();

	for (const record of records) {
		await ctx.db.delete(record._id);
	}
}

// Delete all position records for a collection
export async function deleteAllPositionsForCollection(
	ctx: MutationCtx,
	collectionId: Id<'collections'>
) {
	const records = await ctx.db
		.query('itemCollectionPositions')
		.withIndex('by_collection', (q) => q.eq('collectionId', collectionId))
		.collect();

	for (const record of records) {
		await ctx.db.delete(record._id);
	}
}

// Reorder an item within a collection
export const reorderItem = mutation({
	args: {
		itemId: v.id('items'),
		collectionId: v.id('collections'),
		newPosition: v.string(),
		token: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		requireAuth(args.token);
		const item = await ctx.db.get(args.itemId);
		if (!item) throw new Error('Item not found');

		const collection = await ctx.db.get(args.collectionId);
		if (!collection) throw new Error('Collection not found');

		// Check if item is actually in this collection
		if (!item.collections.includes(args.collectionId)) {
			throw new Error('Item is not in this collection');
		}

		// Find existing position record
		const record = await ctx.db
			.query('itemCollectionPositions')
			.withIndex('by_item_and_collection', (q) =>
				q.eq('itemId', args.itemId).eq('collectionId', args.collectionId)
			)
			.unique();

		if (!record) {
			// Create position record if it doesn't exist (for items added before position system)
			await ctx.db.insert('itemCollectionPositions', {
				itemId: args.itemId,
				collectionId: args.collectionId,
				position: args.newPosition,
				dateAdded: Date.now()
			});
		} else {
			// Update existing position
			await ctx.db.patch(record._id, {
				position: args.newPosition
			});
		}
	}
});

// Query to list items by collection with positions (for use in items.ts)
export const listByCollectionWithPositions = query({
	args: { collectionId: v.id('collections') },
	handler: async (ctx, args) => {
		return await getPositionsByCollection(ctx, args.collectionId);
	}
});
