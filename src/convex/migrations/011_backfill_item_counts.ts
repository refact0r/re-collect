import { internalMutation } from '../_generated/server';

// Backfill collections.itemCount from itemCollectionPositions rows.
// Safe to rerun; counts are maintained going forward by the membership
// helpers in itemCollectionPositions.ts.
export const backfillItemCounts = internalMutation({
	args: {},
	handler: async (ctx) => {
		const collections = await ctx.db.query('collections').collect();

		for (const collection of collections) {
			const positions = await ctx.db
				.query('itemCollectionPositions')
				.withIndex('by_collection', (q) => q.eq('collectionId', collection._id))
				.collect();
			await ctx.db.patch(collection._id, { itemCount: positions.length });
		}

		return { collectionsBackfilled: collections.length };
	}
});
