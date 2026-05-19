import { internalMutation } from '../_generated/server';
import { buildSearchText } from '../lib/searchText';

// Clears the legacy `paletteDescription` field from every item and rebuilds
// `searchText` (since the field used to be folded in). Run on both dev and
// prod before removing the field from the schema.
export const run = internalMutation({
	args: {},
	handler: async (ctx) => {
		const items = await ctx.db.query('items').collect();
		let updated = 0;

		for (const item of items) {
			if ((item as { paletteDescription?: string }).paletteDescription === undefined) {
				continue;
			}

			await ctx.db.patch(item._id, {
				searchText: buildSearchText({
					title: item.title,
					description: item.description,
					url: item.url,
					styles: item.styles,
					aiTags: item.aiTags,
					subject: item.subject
				}),
				...({ paletteDescription: undefined } as Record<string, unknown>)
			});
			updated++;
		}

		return { total: items.length, updated };
	}
});
