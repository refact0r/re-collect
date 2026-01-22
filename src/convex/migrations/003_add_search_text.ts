import { internalMutation } from '../_generated/server';

export const migrateSearchText = internalMutation({
	args: {},
	handler: async (ctx) => {
		const items = await ctx.db.query('items').collect();
		let updated = 0;

		for (const item of items) {
			if (item.searchText === undefined) {
				const searchText = [item.title, item.description, item.url].filter(Boolean).join(' ');

				await ctx.db.patch(item._id, { searchText });
				updated++;
			}
		}

		return { success: true, itemsUpdated: updated };
	}
});
