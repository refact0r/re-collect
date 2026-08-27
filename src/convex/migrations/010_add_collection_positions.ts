import { internalMutation } from '../_generated/server';
import { generateKeyBetween } from 'fractional-indexing';

// Backfill manual-order positions for collections, preserving the
// previous display order (newest first)
export const migrateCollectionPositions = internalMutation({
	args: {},
	handler: async (ctx) => {
		const collections = await ctx.db.query('collections').order('desc').collect();

		let previousPosition: string | null = null;
		let updated = 0;

		for (const collection of collections) {
			if (collection.position) {
				previousPosition = collection.position;
				continue;
			}

			const position = generateKeyBetween(previousPosition, null);
			await ctx.db.patch(collection._id, { position });
			previousPosition = position;
			updated++;
		}

		return { success: true, updated };
	}
});
