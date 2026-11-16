import { v } from 'convex/values';
import { Workpool } from '@convex-dev/workpool';
import { components, internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { internalMutation, internalQuery, type MutationCtx } from './_generated/server';
import { r2 } from './r2';
import { imageVariantValidator } from './schema';

// The database side of image variants (lib/imageVariants.ts); the resizing
// itself is imageVariantActions.makeVariants (Node, for sharp).

// A few at once: each run holds a decoded original (up to 30 MB of file) in
// memory. Retries cover a fetch or upload that fails in passing.
const variantPool = new Workpool(components.variantPool, {
	maxParallelism: 3,
	retryActionsByDefault: true,
	defaultRetryBehavior: { maxAttempts: 3, initialBackoffMs: 2000, base: 4 }
});

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

// The image a run should make variants for, or null if there's nothing to do
export const variantJob = internalQuery({
	args: { itemId: v.id('items') },
	handler: async (ctx, { itemId }) => {
		const item = await ctx.db.get(itemId);
		if (!item?.imageKey || item.imageVariants) return null;
		return { imageKey: item.imageKey };
	}
});

// Records a run's variants, unless the image changed (or another run finished
// first) meanwhile, in which case the new objects belong to no one
export const saveVariants = internalMutation({
	args: {
		itemId: v.id('items'),
		imageKey: v.string(),
		variants: v.array(imageVariantValidator),
		// The original's upright size, filled in where the item lacks it
		width: v.optional(v.number()),
		height: v.optional(v.number())
	},
	handler: async (ctx, { itemId, imageKey, variants, width, height }) => {
		const item = await ctx.db.get(itemId);
		if (item?.imageKey !== imageKey || item.imageVariants) {
			for (const { key } of variants) await r2.deleteObject(ctx, key);
			return;
		}
		await ctx.db.patch(itemId, {
			imageVariants: variants,
			...(!item.imageWidth && width && height && { imageWidth: width, imageHeight: height })
		});
	}
});

// Deletes what a run stored before it failed partway
export const discardVariants = internalMutation({
	args: { variants: v.array(imageVariantValidator) },
	handler: async (ctx, { variants }) => {
		for (const { key } of variants) await r2.deleteObject(ctx, key);
	}
});

// Queues every item whose image has no variants yet.
// Run with `npx convex run imageVariants:backfill` (add --prod for production)
export const backfill = internalMutation({
	args: { cursor: v.optional(v.string()), scheduled: v.optional(v.number()) },
	handler: async (ctx, args) => {
		const { page, isDone, continueCursor } = await ctx.db
			.query('items')
			.paginate({ numItems: 100, cursor: args.cursor ?? null });
		let scheduled = args.scheduled ?? 0;
		for (const item of page) {
			if (!item.imageKey || item.imageVariants) continue;
			await scheduleImageVariants(ctx, item._id);
			scheduled++;
		}
		if (!isDone) {
			await ctx.scheduler.runAfter(0, internal.imageVariants.backfill, {
				cursor: continueCursor,
				scheduled
			});
		} else {
			console.log(`image variants backfill: ${scheduled} items scheduled`);
		}
	}
});
