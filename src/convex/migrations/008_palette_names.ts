import { internalMutation } from '../_generated/server';
import { buildSearchText } from '../lib/searchText';
import { colorNamesForPalette } from '../lib/colorNames';

// Backfill paletteNames (and refresh searchText) for items that already have
// paletteHex. Color names are derived deterministically from hex values, so no
// re-extraction from images is needed.
export const backfillPaletteNames = internalMutation({
	args: {},
	handler: async (ctx) => {
		const items = await ctx.db.query('items').collect();
		let updated = 0;

		for (const item of items) {
			if (!item.paletteHex || item.paletteHex.length === 0) continue;
			const paletteNames = colorNamesForPalette(item.paletteHex);
			await ctx.db.patch(item._id, {
				paletteNames,
				searchText: buildSearchText({
					title: item.title,
					description: item.description,
					url: item.url,
					styles: item.styles,
					aiTags: item.aiTags,
					subject: item.subject,
					paletteNames
				})
			});
			updated++;
		}

		return { success: true, itemsUpdated: updated };
	}
});
