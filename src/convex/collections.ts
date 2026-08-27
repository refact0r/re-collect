import { v } from 'convex/values';
import { query, type QueryCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { generateKeyBetween } from 'fractional-indexing';
import { removeItemFromCollection } from './itemCollectionPositions';
import { getImageUrl } from './items';
import { authedMutation } from './lib/auth';
import {
	taggingModeValidator,
	linkImageModeValidator,
	collectionSortModeValidator
} from './schema';

// Manual order by fractional-index position (backfilled by migration 010)
async function listSorted(ctx: QueryCtx) {
	const collections = await ctx.db.query('collections').collect();
	return collections.sort((a, b) => ((a.position ?? '') < (b.position ?? '') ? -1 : 1));
}

export const create = authedMutation({
	args: {
		name: v.string()
	},
	handler: async (ctx, args) => {
		// New collections go to the bottom of the manual order
		const sorted = await listSorted(ctx);
		const lastPos = sorted[sorted.length - 1]?.position ?? null;
		return await ctx.db.insert('collections', {
			name: args.name,
			dateCreated: Date.now(),
			position: generateKeyBetween(lastPos, null)
		});
	}
});

export const reorder = authedMutation({
	args: {
		id: v.id('collections'),
		newPosition: v.string()
	},
	handler: async (ctx, args) => {
		const existing = await ctx.db.get(args.id);
		if (!existing) throw new Error('Collection not found');

		await ctx.db.patch(args.id, { position: args.newPosition });
	}
});

export const update = authedMutation({
	args: {
		id: v.id('collections'),
		name: v.optional(v.string()),
		sortMode: v.optional(collectionSortModeValidator),
		viewMode: v.optional(v.union(v.literal('grid'), v.literal('list'))),
		taggingMode: v.optional(taggingModeValidator),
		linkImageMode: v.optional(linkImageModeValidator)
	},
	handler: async (ctx, args) => {
		const { id, ...updates } = args;
		const existing = await ctx.db.get(id);
		if (!existing) throw new Error('Collection not found');

		await ctx.db.patch(id, updates);
	}
});

// Delete a collection (also removes it from all items)
export const remove = authedMutation({
	args: { id: v.id('collections') },
	handler: async (ctx, args) => {
		const collection = await ctx.db.get(args.id);
		if (!collection) throw new Error('Collection not found');

		// Remove every item's membership (positions, collections array, count)
		const positions = await ctx.db
			.query('itemCollectionPositions')
			.withIndex('by_collection', (q) => q.eq('collectionId', args.id))
			.collect();
		for (const position of positions) {
			await removeItemFromCollection(ctx, position.itemId, args.id);
		}

		await ctx.db.delete(args.id);
	}
});

const PREVIEW_LIMIT = 4;
// Newest memberships scanned for displayable images; bounds the read set per collection.
const PREVIEW_SCAN = 24;

async function getCollectionPreviews(
	ctx: QueryCtx,
	collectionId: Id<'collections'>
): Promise<Array<{ _id: Id<'items'>; imageUrl: string; type: 'image' | 'url' }>> {
	const recent = await ctx.db
		.query('itemCollectionPositions')
		.withIndex('by_collection_dateAdded', (q) => q.eq('collectionId', collectionId))
		.order('desc')
		.take(PREVIEW_SCAN);

	const previews: Array<{ _id: Id<'items'>; imageUrl: string; type: 'image' | 'url' }> = [];
	for (const position of recent) {
		if (previews.length >= PREVIEW_LIMIT) break;
		const item = await ctx.db.get(position.itemId);
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
	}

	return previews;
}

export const listWithCounts = query({
	args: {},
	handler: async (ctx) => {
		const collections = await listSorted(ctx);

		return Promise.all(
			collections.map(async (collection) => ({
				...collection,
				itemCount: collection.itemCount ?? 0,
				previews: await getCollectionPreviews(ctx, collection._id)
			}))
		);
	}
});
