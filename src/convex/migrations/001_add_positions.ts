import { internalMutation } from '../_generated/server';
import { generateKeyBetween } from 'fractional-indexing';

// Migration to add position records for existing items in collections
export const migratePositions = internalMutation({
	args: {},
	handler: async (ctx) => {
		// Get all collections
		const collections = await ctx.db.query('collections').collect();

		let totalRecords = 0;

		for (const collection of collections) {
			// Get all items in this collection, sorted by dateAdded (newest first)
			const items = await ctx.db.query('items').order('desc').collect();
			const collectionItems = items.filter((item) => item.collections.includes(collection._id));

			// Generate positions for each item
			let previousPosition: string | null = null;

			for (const item of collectionItems) {
				// Check if position record already exists
				const existing = await ctx.db
					.query('itemCollectionPositions')
					.withIndex('by_item_and_collection', (q) =>
						q.eq('itemId', item._id).eq('collectionId', collection._id)
					)
					.unique();

				if (!existing) {
					// Generate next position after the previous one
					const position = generateKeyBetween(previousPosition, null);

					await ctx.db.insert('itemCollectionPositions', {
						itemId: item._id,
						collectionId: collection._id,
						position,
						dateAdded: item.dateAdded
					});

					previousPosition = position;
					totalRecords++;
				}
			}
		}

		return { success: true, recordsCreated: totalRecords };
	}
});
