import { internalMutation } from '../_generated/server';
import { buildSearchText } from '../lib/searchText';
import { dedupePreserveOrder, normalizeTag } from '../tagging';

// Re-run normalizeTag over existing items after extending it to strip
// suffix-noise words like "-design", "-influenced", "-driven", "-based",
// "-heavy" in both space-separated and hyphenated forms. Rebuilds searchText
// for any item whose styles or aiTags changed.
export const normalizeExistingTags = internalMutation({
	args: {},
	handler: async (ctx) => {
		const items = await ctx.db.query('items').collect();
		let updated = 0;

		for (const item of items) {
			const newStyles = item.styles
				? dedupePreserveOrder(item.styles.map(normalizeTag)).filter(Boolean)
				: undefined;
			const styleSet = new Set(newStyles ?? []);
			const newAiTags = item.aiTags
				? dedupePreserveOrder(item.aiTags.map(normalizeTag)).filter(
						(t) => t && !styleSet.has(t)
					)
				: undefined;

			const stylesChanged =
				JSON.stringify(item.styles ?? null) !== JSON.stringify(newStyles ?? null);
			const aiTagsChanged =
				JSON.stringify(item.aiTags ?? null) !== JSON.stringify(newAiTags ?? null);

			if (!stylesChanged && !aiTagsChanged) continue;

			await ctx.db.patch(item._id, {
				styles: newStyles,
				aiTags: newAiTags,
				searchText: buildSearchText({
					title: item.title,
					description: item.description,
					url: item.url,
					styles: newStyles,
					aiTags: newAiTags,
					subject: item.subject,
					paletteNames: item.paletteNames
				})
			});
			updated++;
		}

		return { success: true, itemsUpdated: updated, totalItems: items.length };
	}
});
