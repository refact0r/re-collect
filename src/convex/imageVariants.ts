import { v } from 'convex/values';
import { Workpool } from '@convex-dev/workpool';
import { components, internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { internalMutation, internalQuery, type MutationCtx } from './_generated/server';
import { scheduleEmbedding } from './embeddings';
import { r2 } from './r2';
import { imageVariantValidator } from './schema';

// The database side of image variants (lib/imageVariants.ts); the resizing
// itself is imageVariantActions.makeVariants (Node, for sharp).

// Each run is its own Node action with its own 512 MB (measured: concurrent
// actions don't share memory), so a few run at once. Retries cover a fetch or
// upload that fails in passing, and a warm instance's leftovers.
const variantPool = new Workpool(components.variantPool, {
	maxParallelism: 3,
	retryActionsByDefault: true,
	defaultRetryBehavior: { maxAttempts: 3, initialBackoffMs: 2000, base: 4 }
});

// How long a replaced (oversized) original outlives its replacement: tagging,
// palette and embedding runs queued with the item may still be reading it
const REPLACED_GRACE_MS = 60 * 60 * 1000;

// Asks for the item's variants to be made, once its image is in place. Cheap
// to over-call: the run skips an item whose current image already has them.
export async function scheduleImageVariants(ctx: MutationCtx, itemId: Id<'items'>) {
	await variantPool.enqueueAction(ctx, internal.imageVariantActions.makeVariants, { itemId });
}

// Deletes the item's image and its variants from R2 (the caller replaces or
// clears the fields)
export async function deleteImageObjects(
	ctx: MutationCtx,
	item: Pick<Doc<'items'>, 'imageKey' | 'imageVariants'>
) {
	if (item.imageKey) await r2.deleteObject(ctx, item.imageKey);
	for (const { key } of item.imageVariants ?? []) await r2.deleteObject(ctx, key);
}

// The image key a run should make variants for, or null if there's nothing to do
export const variantJob = internalQuery({
	args: { itemId: v.id('items') },
	handler: async (ctx, { itemId }) => {
		const item = await ctx.db.get(itemId);
		return item?.imageKey && !item.imageVariants ? item.imageKey : null;
	}
});

// Records a run's variants, and the image that replaces an oversized original,
// unless the image changed (or another run finished first) meanwhile, in which
// case the new objects belong to no one
export const saveVariants = internalMutation({
	args: {
		itemId: v.id('items'),
		imageKey: v.string(),
		variants: v.array(imageVariantValidator),
		original: v.optional(v.object({ key: v.string(), width: v.number(), height: v.number() })),
		// The original's upright size, filled in where the item lacks it
		width: v.optional(v.number()),
		height: v.optional(v.number())
	},
	handler: async (ctx, { itemId, imageKey, variants, original, width, height }) => {
		const item = await ctx.db.get(itemId);
		if (item?.imageKey !== imageKey || item.imageVariants) {
			if (original) await r2.deleteObject(ctx, original.key);
			for (const { key } of variants) await r2.deleteObject(ctx, key);
			return;
		}
		if (original) {
			await ctx.db.patch(itemId, {
				imageKey: original.key,
				imageWidth: original.width,
				imageHeight: original.height,
				imageVariants: variants
			});
			await ctx.scheduler.runAfter(REPLACED_GRACE_MS, internal.imageVariants.deleteObjects, {
				keys: [imageKey]
			});
			// Same picture, but an embedding is keyed by the image it was made from
			await scheduleEmbedding(ctx, itemId);
			return;
		}
		await ctx.db.patch(itemId, {
			imageVariants: variants,
			...(!item.imageWidth && width && height && { imageWidth: width, imageHeight: height })
		});
	}
});

// Deletes R2 objects no item points at: what a failed run stored, or a
// replaced original
export const deleteObjects = internalMutation({
	args: { keys: v.array(v.string()) },
	handler: async (ctx, { keys }) => {
		for (const key of keys) await r2.deleteObject(ctx, key);
	}
});

// Queues every image without variants. With `remake`, every image's variants
// are deleted and made again (after VARIANT_WIDTHS or the encoding changes).
// Run on prod only: dev's items point at prod's objects in the shared bucket, so
// replacing an original there deletes the one prod shows (reference/ops.md).
// `npx convex run --prod imageVariants:backfill` ('{"remake": true}' to remake)
export const backfill = internalMutation({
	args: {
		remake: v.optional(v.boolean()),
		cursor: v.optional(v.string()),
		scheduled: v.optional(v.number())
	},
	handler: async (ctx, { remake, ...args }) => {
		const { page, isDone, continueCursor } = await ctx.db
			.query('items')
			.paginate({ numItems: 100, cursor: args.cursor ?? null });
		let scheduled = args.scheduled ?? 0;
		for (const item of page) {
			if (!item.imageKey || (item.imageVariants && !remake)) continue;
			if (item.imageVariants) {
				for (const { key } of item.imageVariants) await r2.deleteObject(ctx, key);
				await ctx.db.patch(item._id, { imageVariants: undefined });
			}
			await scheduleImageVariants(ctx, item._id);
			scheduled++;
		}
		if (!isDone) {
			await ctx.scheduler.runAfter(0, internal.imageVariants.backfill, {
				remake,
				cursor: continueCursor,
				scheduled
			});
		} else {
			console.log(`image variants backfill: ${scheduled} items scheduled`);
		}
	}
});
