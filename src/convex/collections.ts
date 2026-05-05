import { v } from 'convex/values';
import { mutation, query, type QueryCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { deleteAllPositionsForCollection } from './itemCollectionPositions';
import { getImageUrl } from './items';
import { requireAuth } from './auth';

export const create = mutation({
	args: {
		name: v.string(),
		token: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		requireAuth(args.token);
		return await ctx.db.insert('collections', {
			name: args.name,
			dateCreated: Date.now()
		});
	}
});

export const update = mutation({
	args: {
		id: v.id('collections'),
		name: v.optional(v.string()),
		sortMode: v.optional(
			v.union(
				v.literal('manual'),
				v.literal('dateAddedNewest'),
				v.literal('dateAddedOldest'),
				v.literal('dateModifiedNewest'),
				v.literal('dateModifiedOldest'),
				v.literal('titleAsc'),
				v.literal('titleDesc')
			)
		),
		viewMode: v.optional(v.union(v.literal('grid'), v.literal('list'))),
		token: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		requireAuth(args.token);
		const { id, token, ...updates } = args;
		const existing = await ctx.db.get(id);
		if (!existing) throw new Error('Collection not found');

		await ctx.db.patch(id, updates);
	}
});

// Delete a collection (also removes it from all items)
export const remove = mutation({
	args: { id: v.id('collections'), token: v.optional(v.string()) },
	handler: async (ctx, args) => {
		requireAuth(args.token);
		const collection = await ctx.db.get(args.id);
		if (!collection) throw new Error('Collection not found');

		// First, query positions BEFORE deleting them
		const positions = await ctx.db
			.query('itemCollectionPositions')
			.withIndex('by_collection', (q) => q.eq('collectionId', args.id))
			.collect();

		// Remove this collection from all items that reference it
		await Promise.all(
			positions.map(async (position) => {
				const item = await ctx.db.get(position.itemId);
				if (item) {
					await ctx.db.patch(item._id, {
						collections: item.collections.filter((c) => c !== args.id)
					});
				}
			})
		);

		// Now delete all position records for this collection
		await deleteAllPositionsForCollection(ctx, args.id);

		// Finally, delete the collection itself
		await ctx.db.delete(args.id);
	}
});

export const list = query({
	args: {},
	handler: async (ctx) => {
		return await ctx.db.query('collections').order('desc').collect();
	}
});

export const get = query({
	args: { id: v.id('collections') },
	handler: async (ctx, args) => {
		return await ctx.db.get(args.id);
	}
});

const PREVIEW_LIMIT = 4;
const PREVIEW_BATCH = 8;

async function getCollectionPreviews(
	ctx: QueryCtx,
	positions: Array<{ itemId: Id<'items'>; dateAdded: number }>
): Promise<Array<{ _id: Id<'items'>; imageUrl: string; type: 'image' | 'url' }>> {
	const sorted = [...positions].sort((a, b) => b.dateAdded - a.dateAdded);
	const previews: Array<{ _id: Id<'items'>; imageUrl: string; type: 'image' | 'url' }> = [];

	for (let i = 0; i < sorted.length && previews.length < PREVIEW_LIMIT; i += PREVIEW_BATCH) {
		const batch = sorted.slice(i, i + PREVIEW_BATCH);
		const items = await Promise.all(batch.map((p) => ctx.db.get(p.itemId)));
		for (const item of items) {
			if (!item) continue;
			const displayable =
				(item.type === 'image' && !!item.imageKey) ||
				(item.type === 'url' && item.screenshotStatus === 'completed');
			if (!displayable) continue;
			const imageUrl = getImageUrl(item);
			if (!imageUrl) continue;
			previews.push({
				_id: item._id,
				imageUrl,
				type: item.type as 'image' | 'url'
			});
			if (previews.length >= PREVIEW_LIMIT) break;
		}
	}

	return previews;
}

// Get collection with item count
export const listWithCounts = query({
	args: {},
	handler: async (ctx) => {
		const collections = await ctx.db.query('collections').order('desc').collect();

		return Promise.all(
			collections.map(async (collection) => {
				const positions = await ctx.db
					.query('itemCollectionPositions')
					.withIndex('by_collection', (q) => q.eq('collectionId', collection._id))
					.collect();
				const previews = await getCollectionPreviews(ctx, positions);

				return {
					...collection,
					itemCount: positions.length,
					previews
				};
			})
		);
	}
});
