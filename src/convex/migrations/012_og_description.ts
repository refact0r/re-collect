import { internalMutation } from '../_generated/server';
import { buildSearchText } from '../lib/searchText';

// description was historically auto-filled with og:description by the
// screenshot worker; that text now lives in its own ogDescription field and
// description is purely user notes. Move URL items' descriptions over (any
// genuinely hand-written URL-item notes move too — re-add those by hand).
// Image/text items are untouched: the worker never wrote their descriptions.
export const migrateOgDescriptions = internalMutation({
	args: {},
	handler: async (ctx) => {
		const items = await ctx.db.query('items').collect();
		let updated = 0;

		for (const item of items) {
			if (item.type !== 'url' || !item.description || item.ogDescription) continue;

			await ctx.db.patch(item._id, {
				description: undefined,
				ogDescription: item.description,
				searchText: buildSearchText({
					title: item.title,
					ogDescription: item.description,
					url: item.url,
					styles: item.styles,
					aiTags: item.aiTags,
					subject: item.subject,
					paletteNames: item.paletteNames
				})
			});
			updated++;
		}

		return { success: true, itemsUpdated: updated };
	}
});
