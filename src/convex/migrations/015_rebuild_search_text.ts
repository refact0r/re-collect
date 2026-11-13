import { internalMutation } from '../_generated/server';
import { buildSearchText } from '../lib/searchText';

// Rebuild every item's searchText from its current fields. Run after changing
// a derivation (font naming in lib/fonts.ts, color names, …) so existing items
// pick it up without re-capturing anything.
export const rebuildSearchText = internalMutation({
	args: {},
	handler: async (ctx) => {
		let updated = 0;
		for await (const item of ctx.db.query('items')) {
			const searchText = buildSearchText({
				title: item.title,
				description: item.description,
				ogDescription: item.ogDescription,
				url: item.url,
				styles: item.styles,
				aiTags: item.aiTags,
				subject: item.subject,
				paletteNames: item.paletteNames,
				fonts: item.fonts
			});
			if (searchText === item.searchText) continue;
			await ctx.db.patch(item._id, { searchText });
			updated++;
		}
		return { itemsUpdated: updated };
	}
});
