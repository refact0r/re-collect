import { internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';

// Re-snapshot each collected item's taggingMode from its collection's
// ingestion default and re-tag it in that mode. Mirrors the add-time
// snapshot in items.add: the first collection wins, undefined means
// 'visual', and image items in a text-mode collection fall back to visual.
//
// Non-destructive for mode 'none': the mode is stored but existing tags are
// left in place. Uncollected items are untouched. Safe to rerun.
//
// Run: npx convex run migrations/013_retag_by_collection_default:retagByCollectionDefault
export const retagByCollectionDefault = internalMutation({
	args: {},
	handler: async (ctx) => {
		const items = await ctx.db.query('items').collect();
		let visual = 0;
		let text = 0;
		let none = 0;
		let skipped = 0;

		for (const item of items) {
			// Text items are never tagged; uncollected items keep their snapshot
			if (item.type === 'text' || item.collections.length === 0) {
				skipped++;
				continue;
			}
			// Don't fight an in-flight run or an image that's about to change
			if (
				item.taggingStatus === 'pending' ||
				item.taggingStatus === 'processing' ||
				item.screenshotStatus === 'pending' ||
				item.screenshotStatus === 'processing'
			) {
				skipped++;
				continue;
			}

			const collection = await ctx.db.get(item.collections[0]);
			const rawMode = collection?.taggingMode;
			const mode = item.type === 'image' && rawMode === 'text' ? 'visual' : rawMode;

			if (mode === 'none') {
				await ctx.db.patch(item._id, { taggingMode: 'none' });
				none++;
				continue;
			}

			if (mode === 'text') {
				if (!item.url) {
					skipped++;
					continue;
				}
				await ctx.db.patch(item._id, {
					taggingMode: 'text',
					taggingStatus: 'pending',
					taggingError: undefined
				});
				await ctx.scheduler.runAfter((visual + text) * 500, internal.tagging.tagTextItem, {
					itemId: item._id
				});
				text++;
				continue;
			}

			// 'visual' or undefined (= default visual)
			if (!item.imageKey) {
				skipped++;
				continue;
			}
			await ctx.db.patch(item._id, {
				taggingMode: mode,
				taggingStatus: 'pending',
				taggingError: undefined
			});
			await ctx.scheduler.runAfter((visual + text) * 500, internal.taggingActions.preprocessItem, {
				itemId: item._id
			});
			visual++;
		}

		return { total: items.length, visual, text, none, skipped };
	}
});
