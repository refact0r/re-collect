import { internalMutation } from '../_generated/server';
import { buildSearchText } from '../searchText';

export const removeKind = internalMutation({
	args: {},
	handler: async (ctx) => {
		const items = await ctx.db.query('items').collect();
		let updated = 0;

		for (const item of items) {
			// `kind` was removed from the schema in this same change; cast to read
			// the legacy field off rows that still have it.
			if ((item as { kind?: string }).kind === undefined) continue;

			await ctx.db.patch(item._id, {
				searchText: buildSearchText({
					title: item.title,
					description: item.description,
					url: item.url,
					styles: item.styles,
					aiTags: item.aiTags,
					subject: item.subject,
					paletteDescription: item.paletteDescription
				}),
				...({ kind: undefined } as Record<string, unknown>)
			});
			updated++;
		}

		return { success: true, itemsUpdated: updated };
	}
});
