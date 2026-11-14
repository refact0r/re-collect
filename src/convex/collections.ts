import { ConvexError, v } from 'convex/values';
import type { QueryCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { generateKeyBetween } from 'fractional-indexing';
import { getPositionsByCollection } from './itemCollectionPositions';
import { getImageUrl } from './items';
import { getOwned, userMutation, userQuery, type UserQueryCtx } from './lib/auth';
import {
	taggingModeValidator,
	linkImageModeValidator,
	collectionSortModeValidator
} from './schema';

// The caller's collections in manual (fractional-index position) order
function byPosition(ctx: UserQueryCtx) {
	return ctx.db
		.query('collections')
		.withIndex('by_user_position', (q) => q.eq('userId', ctx.userId));
}

export const create = userMutation({
	args: {
		name: v.string(),
		sortMode: v.optional(collectionSortModeValidator),
		viewMode: v.optional(v.union(v.literal('grid'), v.literal('list'))),
		taggingMode: v.optional(taggingModeValidator),
		linkImageMode: v.optional(linkImageModeValidator)
	},
	handler: async (ctx, args) => {
		// New collections go to the bottom of the manual order
		const last = await byPosition(ctx).order('desc').first();
		return await ctx.db.insert('collections', {
			...args,
			userId: ctx.userId,
			dateCreated: Date.now(),
			position: generateKeyBetween(last?.position ?? null, null)
		});
	}
});

export const reorder = userMutation({
	args: {
		id: v.id('collections'),
		newPosition: v.string()
	},
	handler: async (ctx, args) => {
		if (!(await getOwned(ctx, args.id))) throw new ConvexError('collection not found');
		await ctx.db.patch(args.id, { position: args.newPosition });
	}
});

export const update = userMutation({
	args: {
		id: v.id('collections'),
		name: v.optional(v.string()),
		sortMode: v.optional(collectionSortModeValidator),
		viewMode: v.optional(v.union(v.literal('grid'), v.literal('list'))),
		columnOffset: v.optional(v.number()),
		showTitles: v.optional(v.boolean()),
		taggingMode: v.optional(taggingModeValidator),
		linkImageMode: v.optional(linkImageModeValidator)
	},
	handler: async (ctx, args) => {
		const { id, ...updates } = args;
		if (!(await getOwned(ctx, id))) throw new ConvexError('collection not found');
		await ctx.db.patch(id, updates);
	}
});

// Delete a collection (also removes it from all items)
export const remove = userMutation({
	args: { id: v.id('collections') },
	handler: async (ctx, args) => {
		if (!(await getOwned(ctx, args.id))) throw new ConvexError('collection not found');

		// Drop every membership (position row, item's collections array). The count
		// goes with the collection, and members aren't "modified" by its deletion.
		const positions = await getPositionsByCollection(ctx, args.id);
		for (const position of positions) {
			await ctx.db.delete(position._id);
			const item = await ctx.db.get(position.itemId);
			if (item) {
				await ctx.db.patch(item._id, {
					collections: item.collections.filter((c) => c !== args.id)
				});
			}
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

export const listWithCounts = userQuery({
	args: {},
	handler: async (ctx) => {
		const collections = await byPosition(ctx).collect();

		return Promise.all(
			collections.map(async (collection) => ({
				...collection,
				itemCount: collection.itemCount ?? 0,
				previews: await getCollectionPreviews(ctx, collection._id)
			}))
		);
	}
});
