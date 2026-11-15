import { v } from 'convex/values';
import { internal } from './_generated/api';
import { internalMutation } from './_generated/server';
import { enqueueTagging } from './tagging';

// One-off (2026-11-14): taggingMode 'none' now means AI off entirely, where it
// used to only skip visual tags. Collections that used it for that are read as
// content instead, and their off links re-tagged that way (the embedding
// follows once the tags land). Run once per deployment, then delete this file:
// npx convex run migrations:offToContent '{"collectionIds": [...]}' (--prod)
export const offToContent = internalMutation({
	args: { collectionIds: v.array(v.id('collections')) },
	handler: async (ctx, { collectionIds }) => {
		const retagged: string[] = [];
		for (const collectionId of collectionIds) {
			const collection = await ctx.db.get(collectionId);
			if (!collection) throw new Error(`collection ${collectionId} not found`);
			if (collection.taggingMode === 'none') {
				await ctx.db.patch(collectionId, { taggingMode: 'text' });
			}
			const positions = await ctx.db
				.query('itemCollectionPositions')
				.withIndex('by_collection', (q) => q.eq('collectionId', collectionId))
				.collect();
			for (const { itemId } of positions) {
				const item = await ctx.db.get(itemId);
				if (item?.type !== 'url' || !item.url || item.taggingMode !== 'none') continue;
				if (item.taggingStatus === 'pending') continue;
				await ctx.db.patch(itemId, { taggingMode: 'text', taggingStatus: 'pending' });
				await enqueueTagging(ctx, internal.taggingActions.tagTextItem, itemId);
				retagged.push(item.title ?? item.url);
			}
		}
		return retagged;
	}
});

// The map now lays out only image embeddings, so every cached layout is redone
// on its next visit: npx convex run migrations:staleMaps (--prod)
export const staleMaps = internalMutation({
	args: {},
	handler: async (ctx) => {
		for (const map of await ctx.db.query('embeddingMaps').collect()) {
			await ctx.db.patch(map._id, { version: map.version + 1 });
		}
	}
});
