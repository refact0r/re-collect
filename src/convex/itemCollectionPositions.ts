import { v } from 'convex/values';
import { mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { generateKeyBetween } from 'fractional-indexing';
import { requireAuth } from './lib/auth';

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

// Add item to collection: creates the position record (at the top by default),
// updates the item's denormalized collections array, and bumps the collection's
// itemCount. All membership changes must go through this or removeItemFromCollection.
export async function addItemToCollection(
	ctx: MutationCtx,
	itemId: Id<'items'>,
	collectionId: Id<'collections'>,
	position?: string
) {
	const item = await ctx.db.get(itemId);
	if (!item) throw new Error('Item not found');
	const collection = await ctx.db.get(collectionId);
	if (!collection) throw new Error('Collection not found');

	const existing = await getPositionRecord(ctx, itemId, collectionId);
	if (!existing) {
		let newPosition = position;
		if (!newPosition) {
			const firstPos = await getFirstPosition(ctx, collectionId);
			newPosition = generateKeyBetween(null, firstPos);
		}
		await ctx.db.insert('itemCollectionPositions', {
			itemId,
			collectionId,
			position: newPosition,
			dateAdded: Date.now()
		});
		await ctx.db.patch(collectionId, { itemCount: (collection.itemCount ?? 0) + 1 });
	}

	if (!item.collections.includes(collectionId)) {
		await ctx.db.patch(itemId, {
			collections: [...item.collections, collectionId],
			dateModified: Date.now()
		});
	}
}

// Remove item from collection: deletes the position record, updates the item's
// collections array, and decrements the collection's itemCount.
export async function removeItemFromCollection(
	ctx: MutationCtx,
	itemId: Id<'items'>,
	collectionId: Id<'collections'>
) {
	const record = await getPositionRecord(ctx, itemId, collectionId);
	if (record) {
		await ctx.db.delete(record._id);
		const collection = await ctx.db.get(collectionId);
		if (collection) {
			await ctx.db.patch(collectionId, {
				itemCount: Math.max(0, (collection.itemCount ?? 0) - 1)
			});
		}
	}

	const item = await ctx.db.get(itemId);
	if (item && item.collections.includes(collectionId)) {
		await ctx.db.patch(itemId, {
			collections: item.collections.filter((c) => c !== collectionId),
			dateModified: Date.now()
		});
	}
}

// Delete all position records for an item (used when deleting the item itself)
export async function deleteAllPositionsForItem(ctx: MutationCtx, itemId: Id<'items'>) {
	const records = await ctx.db
		.query('itemCollectionPositions')
		.withIndex('by_item', (q) => q.eq('itemId', itemId))
		.collect();

	for (const record of records) {
		await ctx.db.delete(record._id);
		const collection = await ctx.db.get(record.collectionId);
		if (collection) {
			await ctx.db.patch(collection._id, {
				itemCount: Math.max(0, (collection.itemCount ?? 0) - 1)
			});
		}
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

		const record = await getPositionRecord(ctx, args.itemId, args.collectionId);
		if (!record) throw new Error('Position record not found');

		await ctx.db.patch(record._id, {
			position: args.newPosition
		});
	}
});

// Query to list items by collection with positions (for use in items.ts)
export const listByCollectionWithPositions = query({
	args: { collectionId: v.id('collections') },
	handler: async (ctx, args) => {
		return await getPositionsByCollection(ctx, args.collectionId);
	}
});
