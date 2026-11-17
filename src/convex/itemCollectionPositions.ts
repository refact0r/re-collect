import { ConvexError, v } from 'convex/values';
import type { MutationCtx, QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { generateKeyBetween } from 'fractional-indexing';
import { getOwned, userMutation } from './lib/auth';

function positionsOf(ctx: QueryCtx, collectionId: Id<'collections'>) {
	return ctx.db
		.query('itemCollectionPositions')
		.withIndex('by_collection', (q) => q.eq('collectionId', collectionId));
}

async function getPositionRecord(
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

// All position records for a collection, in position order
export async function getPositionsByCollection(ctx: QueryCtx, collectionId: Id<'collections'>) {
	return await positionsOf(ctx, collectionId).collect();
}

// Puts the item at the top of the collection, keeping the item's collections
// array and the collection's itemCount in step. Every membership change goes
// through this or removeItemFromCollection (collections.remove drops a whole
// collection's at once). Both must share an owner, so membership never crosses users.
export async function addItemToCollection(
	ctx: MutationCtx,
	itemId: Id<'items'>,
	collectionId: Id<'collections'>
) {
	const item = await ctx.db.get(itemId);
	if (!item) throw new Error('Item not found');
	const collection = await ctx.db.get(collectionId);
	if (!collection || collection.userId !== item.userId) {
		throw new ConvexError('collection not found');
	}

	if (!(await getPositionRecord(ctx, itemId, collectionId))) {
		const first = await positionsOf(ctx, collectionId).first();
		await ctx.db.insert('itemCollectionPositions', {
			itemId,
			collectionId,
			position: generateKeyBetween(null, first?.position ?? null),
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

export async function removeItemFromCollection(
	ctx: MutationCtx,
	itemId: Id<'items'>,
	collectionId: Id<'collections'>
) {
	const record = await getPositionRecord(ctx, itemId, collectionId);
	if (record) await deletePosition(ctx, record);

	const item = await ctx.db.get(itemId);
	if (item && item.collections.includes(collectionId)) {
		await ctx.db.patch(itemId, {
			collections: item.collections.filter((c) => c !== collectionId),
			dateModified: Date.now()
		});
	}
}

// Drops an item's position rows, leaving its collections array: for deleting the item
export async function deleteAllPositionsForItem(ctx: MutationCtx, itemId: Id<'items'>) {
	const records = await ctx.db
		.query('itemCollectionPositions')
		.withIndex('by_item_and_collection', (q) => q.eq('itemId', itemId))
		.collect();
	for (const record of records) await deletePosition(ctx, record);
}

// Deletes a position row and counts it off its collection
async function deletePosition(ctx: MutationCtx, record: Doc<'itemCollectionPositions'>) {
	await ctx.db.delete(record._id);
	const collection = await ctx.db.get(record.collectionId);
	if (collection) {
		await ctx.db.patch(collection._id, {
			itemCount: Math.max(0, (collection.itemCount ?? 0) - 1)
		});
	}
}

// Reorder an item within a collection. Owning the collection is enough: a
// membership row only links an item and collection with the same owner.
export const reorderItem = userMutation({
	args: {
		itemId: v.id('items'),
		collectionId: v.id('collections'),
		newPosition: v.string()
	},
	handler: async (ctx, args) => {
		if (!(await getOwned(ctx, args.collectionId))) throw new ConvexError('collection not found');
		const record = await getPositionRecord(ctx, args.itemId, args.collectionId);
		if (!record) throw new ConvexError('item is not in this collection');
		await ctx.db.patch(record._id, { position: args.newPosition });
	}
});
