import { internalMutation } from '../_generated/server';
import { generateKeyBetween } from 'fractional-indexing';

// Assign fresh sequential manual-order positions to ALL collections,
// preserving the currently displayed order (position asc, unpositioned
// first by creation time — matching collections.listSorted). Safe to
// rerun; also repairs duplicate positions created by pre-migration drags.
export const migrateCollectionPositions = internalMutation({
	args: {},
	handler: async (ctx) => {
		const collections = await ctx.db.query('collections').collect();
		collections.sort((a, b) => ((a.position ?? '') < (b.position ?? '') ? -1 : 1));

		let previousPosition: string | null = null;
		const order: string[] = [];

		for (const collection of collections) {
			const position = generateKeyBetween(previousPosition, null);
			await ctx.db.patch(collection._id, { position });
			previousPosition = position;
			order.push(`${position} ${collection.name}`);
		}

		return { success: true, order };
	}
});
