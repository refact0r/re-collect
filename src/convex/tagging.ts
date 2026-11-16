import { ConvexError, v } from 'convex/values';
import type { FunctionReference } from 'convex/server';
import { Workpool, vOnCompleteArgs } from '@convex-dev/workpool';
import { internalMutation, internalQuery, type MutationCtx } from './_generated/server';
import { internal, components } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { getOwned, userMutation } from './lib/auth';
import { patchItem } from './lib/searchText';
import { colorNamesForPalette } from './lib/colorNames';
import { MAX_ERROR_CHARS } from './lib/tagger';
import { TAGGING_MODES, storedTaggingMode, taggingModeOf } from './lib/taggingModes';
import { deleteItemEmbeddings, scheduleEmbedding } from './embeddings';
import { taggingModeValidator } from './schema';

// The database side of tagging; the runs themselves are the Node actions in
// taggingActions.ts.

// Every tagging run goes through this pool so it always settles: the actions
// record their own failures, and onTaggingComplete catches runs that died
// without doing so (OOM, timeout, restart). No pool-level retries — the
// actions already retry the LLM call themselves.
const taggingPool = new Workpool(components.taggingPool, { maxParallelism: 10 });

type TaggingAction = FunctionReference<'action', 'internal', { itemId: Id<'items'> }>;

export async function enqueueTagging(ctx: MutationCtx, fn: TaggingAction, itemId: Id<'items'>) {
	await taggingPool.enqueueAction(
		ctx,
		fn,
		{ itemId },
		{
			onComplete: internal.tagging.onTaggingComplete,
			onCompleteExcludeKinds: ['success'],
			context: { itemId }
		}
	);
}

export const onTaggingComplete = internalMutation({
	args: vOnCompleteArgs(v.object({ itemId: v.id('items') })),
	handler: async (ctx, args) => {
		const item = await ctx.db.get(args.context.itemId);
		if (item?.taggingStatus !== 'pending') return;

		await ctx.db.patch(args.context.itemId, {
			taggingStatus: 'failed',
			taggingError:
				args.result.kind === 'failed'
					? args.result.error.slice(0, MAX_ERROR_CHARS)
					: 'Tagging was canceled'
		});
		await scheduleEmbedding(ctx, args.context.itemId);
	}
});

export const getItemForTagging = internalQuery({
	args: { itemId: v.id('items') },
	handler: async (ctx, args): Promise<Doc<'items'> | null> => {
		return await ctx.db.get(args.itemId);
	}
});

export const setCompleted = internalMutation({
	args: {
		itemId: v.id('items'),
		styles: v.array(v.string()),
		subject: v.string(),
		aiTags: v.array(v.string()),
		modelVersion: v.string()
	},
	handler: async (ctx, { itemId, modelVersion, ...tags }) => {
		const item = await ctx.db.get(itemId);
		if (!item) return;
		await patchItem(ctx, item, {
			...tags,
			taggingStatus: 'completed',
			taggingModelVersion: modelVersion,
			taggingError: undefined
		});
		// Text-mode items embed their tags; a mode change swaps image for text
		await scheduleEmbedding(ctx, itemId);
	}
});

export const setFailed = internalMutation({
	args: {
		itemId: v.id('items'),
		error: v.string()
	},
	handler: async (ctx, args) => {
		const item = await ctx.db.get(args.itemId);
		if (!item) return;
		await ctx.db.patch(args.itemId, {
			taggingStatus: 'failed',
			taggingError: args.error.slice(0, MAX_ERROR_CHARS)
		});
		await scheduleEmbedding(ctx, args.itemId);
	}
});

export const setPaletteHex = internalMutation({
	args: { itemId: v.id('items'), paletteHex: v.array(v.string()) },
	handler: async (ctx, args) => {
		const item = await ctx.db.get(args.itemId);
		if (!item) return;
		await patchItem(ctx, item, {
			paletteHex: args.paletteHex,
			paletteNames: colorNamesForPalette(args.paletteHex)
		});
	}
});

// Switches how an item is understood and re-tags it in that mode: 'visual' tags
// its image, 'text' a link's article (a note isn't tagged, only embedded), and
// 'none' turns AI off, clearing what it wrote and the item's embedding
export const retagItem = userMutation({
	args: {
		itemId: v.id('items'),
		// Omitted: retag in the item's current mode
		mode: v.optional(taggingModeValidator)
	},
	handler: async (ctx, args) => {
		const item = await getOwned(ctx, args.itemId);
		if (!item) throw new ConvexError('item not found');
		// `pending` is set in the same transaction as the enqueue and cleared only
		// when the run settles, so this is what keeps runs from overlapping (and a
		// run's results from landing on an item just turned off)
		if (item.taggingStatus === 'pending') throw new ConvexError('tagging already in progress');

		const mode = args.mode ?? taggingModeOf(item);
		if (!TAGGING_MODES[item.type].includes(mode)) {
			throw new ConvexError(
				item.type === 'text'
					? 'notes are read by their content'
					: 'only URL items can be text-tagged'
			);
		}
		if (mode === 'none') {
			await patchItem(ctx, item, {
				taggingMode: 'none',
				taggingStatus: undefined,
				taggingError: undefined,
				taggingModelVersion: undefined,
				subject: undefined,
				styles: undefined,
				aiTags: undefined
			});
			await deleteItemEmbeddings(ctx, item._id);
			return;
		}
		if (item.type === 'text') {
			await ctx.db.patch(args.itemId, { taggingMode: storedTaggingMode(item.type, mode) });
			await scheduleEmbedding(ctx, args.itemId);
			return;
		}
		if (mode === 'text') {
			if (!item.url) throw new ConvexError('only URL items can be text-tagged');
		} else {
			if (!item.imageKey) throw new ConvexError('item has no image to tag');
			// Don't tag an image that's about to be replaced; the new image
			// schedules its own tagging (or palette) when it lands
			if (item.screenshotStatus === 'pending') {
				throw new ConvexError('image fetch in progress; wait for it to finish');
			}
		}

		// Manually tagging an item opts it into that mode for future runs
		await ctx.db.patch(args.itemId, {
			taggingMode: mode,
			taggingStatus: 'pending',
			taggingError: undefined
		});

		await enqueueTagging(
			ctx,
			mode === 'text' ? internal.taggingActions.tagTextItem : internal.taggingActions.tagImageItem,
			args.itemId
		);
	}
});
