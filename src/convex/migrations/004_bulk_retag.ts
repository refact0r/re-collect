import { internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';

export const bulkRetag = internalMutation({
	args: {},
	handler: async (ctx) => {
		const items = await ctx.db.query('items').collect();
		let scheduled = 0;
		let skipped = 0;

		for (const item of items) {
			if (item.type === 'text' || !item.imageKey) {
				skipped++;
				continue;
			}

			await ctx.db.patch(item._id, {
				taggingStatus: 'pending',
				taggingError: undefined
			});

			await ctx.scheduler.runAfter(0, internal.taggingActions.preprocessItem, {
				itemId: item._id
			});
			scheduled++;
		}

		return { total: items.length, scheduled, skipped };
	}
});
