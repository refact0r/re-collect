import { v } from 'convex/values';
import type { QueryCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { generateKeyBetween } from 'fractional-indexing';
import { removeItemFromCollection } from './itemCollectionPositions';
import { getImageUrl } from './items';
import {
	getOwned,
	getViewable,
	userMutation,
	userQuery,
	viewerQuery,
	type UserQueryCtx
} from './lib/auth';
import {
	taggingModeValidator,
	linkImageModeValidator,
	collectionSortModeValidator
} from './schema';

// Manual order by fractional-index position (backfilled by migration 010)
async function listSorted(ctx: UserQueryCtx) {
	return await ctx.db
		.query('collections')
		.withIndex('by_user_position', (q) => q.eq('userId', ctx.userId))
		.collect();
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
		const sorted = await listSorted(ctx);
		const lastPos = sorted[sorted.length - 1]?.position ?? null;
		return await ctx.db.insert('collections', {
			userId: ctx.userId,
			name: args.name,
			dateCreated: Date.now(),
			position: generateKeyBetween(lastPos, null),
			sortMode: args.sortMode,
			viewMode: args.viewMode,
			taggingMode: args.taggingMode,
			linkImageMode: args.linkImageMode
		});
	}
});

export const reorder = userMutation({
	args: {
		id: v.id('collections'),
		newPosition: v.string()
	},
	handler: async (ctx, args) => {
		const existing = await getOwned(ctx, args.id);
		if (!existing) throw new Error('Collection not found');

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
		shared: v.optional(v.boolean()),
		taggingMode: v.optional(taggingModeValidator),
		linkImageMode: v.optional(linkImageModeValidator)
	},
	handler: async (ctx, args) => {
		const { id, ...updates } = args;
		const existing = await getOwned(ctx, id);
		if (!existing) throw new Error('Collection not found');

		await ctx.db.patch(id, updates);
	}
});

// Delete a collection (also removes it from all items)
export const remove = userMutation({
	args: { id: v.id('collections') },
	handler: async (ctx, args) => {
		const collection = await getOwned(ctx, args.id);
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
	collectionId: Id<'collections'>,
	limit = PREVIEW_LIMIT
): Promise<Array<{ _id: Id<'items'>; imageUrl: string; type: 'image' | 'url' }>> {
	const recent = await ctx.db
		.query('itemCollectionPositions')
		.withIndex('by_collection_dateAdded', (q) => q.eq('collectionId', collectionId))
		.order('desc')
		.take(PREVIEW_SCAN);

	const previews: Array<{ _id: Id<'items'>; imageUrl: string; type: 'image' | 'url' }> = [];
	for (const position of recent) {
		if (previews.length >= limit) break;
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

// One collection as anyone allowed to see it does: the owner, or anyone at all
// once it's shared. Takes the id as a string since it comes straight from a
// URL. Only the display fields go out, plus the owner's name and a cover image
// for link previews.
export const get = viewerQuery({
	args: { id: v.string() },
	handler: async (ctx, args) => {
		const id = ctx.db.normalizeId('collections', args.id);
		const collection = id && (await getViewable(ctx, id));
		if (!collection) return null;
		const owner = await ctx.db.get(collection.userId);
		const [cover] = await getCollectionPreviews(ctx, collection._id, 1);
		return {
			_id: collection._id,
			name: collection.name,
			itemCount: collection.itemCount ?? 0,
			sortMode: collection.sortMode,
			viewMode: collection.viewMode,
			columnOffset: collection.columnOffset,
			showTitles: collection.showTitles,
			shared: collection.shared ?? false,
			owner: owner?.username ?? '',
			isOwner: collection.userId === ctx.viewerId,
			coverUrl: cover?.imageUrl ?? null
		};
	}
});
