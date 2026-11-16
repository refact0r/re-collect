import { ConvexError, v, type Infer } from 'convex/values';
import {
	internalAction,
	internalMutation,
	internalQuery,
	type MutationCtx
} from './_generated/server';
import { internal, components } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { NonRetryableError, Workpool, vOnCompleteArgs } from '@convex-dev/workpool';
import { getOwned, userMutation } from './lib/auth';
import { r2 } from './r2';
import { patchItem } from './lib/searchText';
import { MAX_ERROR_CHARS } from './lib/tagger';
import { taggingModeOf } from './lib/taggingModes';
import { linkImageModeValidator, siteFontValidator } from './schema';
import { parseSiteFonts } from './lib/fonts';
import { enqueueTagging } from './tagging';
import { scheduleEmbedding } from './embeddings';
import { deleteImageObjects, scheduleImageVariants } from './imageVariants';

// Well above the worker's worst case (~2 min: og fast path, browser launch,
// navigation, network idle, settle delay, og image fetch, R2 put)
const WORKER_TIMEOUT_MS = 180_000;

// Serializes captures so the Cloudflare free plan's launch limits (1 new
// browser per 20s, 3 concurrent) don't drop screenshots during burst saves.
// Rate-limited attempts throw and are retried here with ~25s backoff.
const screenshotPool = new Workpool(components.screenshotPool, {
	maxParallelism: 1,
	retryActionsByDefault: true,
	defaultRetryBehavior: { maxAttempts: 4, initialBackoffMs: 25000, base: 2 }
});

export async function enqueueScreenshot(
	ctx: MutationCtx,
	args: { itemId: Id<'items'>; url: string; mode?: Infer<typeof linkImageModeValidator> }
): Promise<void> {
	await screenshotPool.enqueueAction(ctx, internal.screenshots.generateScreenshotInternal, args, {
		onComplete: internal.screenshots.onScreenshotComplete,
		onCompleteExcludeKinds: ['success'],
		context: { itemId: args.itemId }
	});
}

// Lets a queued capture for a since-deleted item skip the worker call
export const itemExists = internalQuery({
	args: { itemId: v.id('items') },
	handler: async (ctx, args): Promise<boolean> => (await ctx.db.get(args.itemId)) !== null
});

export const setCompleted = internalMutation({
	args: {
		itemId: v.id('items'),
		imageKey: v.string(),
		imageWidth: v.number(),
		imageHeight: v.number(),
		title: v.optional(v.string()),
		description: v.optional(v.string()),
		// Absent when the worker didn't render the page (og fast path): keep the old ones
		fonts: v.optional(v.array(siteFontValidator))
	},
	handler: async (ctx, args) => {
		const item = await ctx.db.get(args.itemId);
		// Deleted while its capture ran: the worker's new object belongs to no one
		if (!item) {
			await r2.deleteObject(ctx, args.imageKey);
			return;
		}

		const replaced = item.imageKey !== args.imageKey;
		if (replaced) await deleteImageObjects(ctx, item);

		// Only fill a title the user hasn't written themselves. og:description
		// goes to its own machine-owned field (kept if a re-fetch returns none);
		// description stays purely user notes.
		const title = item.title || args.title || undefined;
		const ogDescription = args.description ?? item.ogDescription;
		const fonts = args.fonts ?? item.fonts;
		// Text-mode items tag off the article (scheduled at add time), so a new
		// image only triggers palette extraction, not visual tagging
		const wantsVisualTagging = taggingModeOf(item) === 'visual';

		await patchItem(ctx, item, {
			screenshotStatus: 'completed',
			imageKey: args.imageKey,
			imageWidth: args.imageWidth,
			imageHeight: args.imageHeight,
			...(replaced && { imageVariants: undefined }),
			screenshotError: undefined,
			...(wantsVisualTagging && { taggingStatus: 'pending' as const, taggingError: undefined }),
			title,
			ogDescription,
			fonts
		});

		// Palette runs on every new image; the LLM tagger only when visual tagging is on
		if (wantsVisualTagging) {
			await enqueueTagging(ctx, internal.taggingActions.tagImageItem, args.itemId);
		} else {
			await ctx.scheduler.runAfter(0, internal.taggingActions.repaletteItem, {
				itemId: args.itemId
			});
		}
		await scheduleImageVariants(ctx, args.itemId);
		await scheduleEmbedding(ctx, args.itemId);
	}
});

// Fonts read outside a capture: experiments/design-tokens/backfill.mjs loads
// pages in local Chrome (sparing the worker's browser quota) and writes here
export const setFonts = internalMutation({
	args: {
		items: v.array(v.object({ itemId: v.id('items'), fonts: v.array(siteFontValidator) }))
	},
	handler: async (ctx, args) => {
		for (const { itemId, fonts } of args.items) {
			const item = await ctx.db.get(itemId);
			if (item) await patchItem(ctx, item, { fonts });
		}
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
		await settleFailed(ctx, item, args.error);
	}
});

// A failed re-fetch keeps showing the image the item already has (the error is
// kept for the editor); only an item with no image at all is failed
async function settleFailed(ctx: MutationCtx, item: Doc<'items'>, error: string) {
	await ctx.db.patch(item._id, {
		screenshotStatus: item.imageKey ? 'completed' : 'failed',
		screenshotError: error.slice(0, MAX_ERROR_CHARS)
	});
	// No longer waiting on a capture: embeds as its image, or its text without one
	await scheduleEmbedding(ctx, item._id);
}

// Re-fetch a URL item's image, switching to the given mode; omitting the mode
// refreshes in the item's current one (e.g. retrying a failed capture)
export const reimageItem = userMutation({
	args: {
		itemId: v.id('items'),
		mode: v.optional(linkImageModeValidator)
	},
	handler: async (ctx, args) => {
		const item = await getOwned(ctx, args.itemId);
		if (!item) throw new ConvexError('item not found');
		if (item.type !== 'url' || !item.url) throw new ConvexError('item is not a URL item');
		// Set in the same transaction as the enqueue, so captures never overlap
		if (item.screenshotStatus === 'pending') {
			throw new ConvexError('image fetch already in progress');
		}
		// A tagging job holds a reference to the current image; replacing the
		// image underneath it would let its stale results land afterwards
		if (item.taggingStatus === 'pending') {
			throw new ConvexError('tagging in progress; wait for it to finish');
		}

		const mode = args.mode ?? item.linkImageMode;
		await ctx.db.patch(args.itemId, {
			linkImageMode: mode,
			screenshotStatus: 'pending',
			screenshotError: undefined
		});

		await enqueueScreenshot(ctx, { itemId: args.itemId, url: item.url, mode });
	}
});

export const generateScreenshotInternal = internalAction({
	args: {
		itemId: v.id('items'),
		url: v.string(),
		mode: v.optional(linkImageModeValidator)
	},
	handler: async (ctx, args): Promise<void> => {
		const workerUrl = process.env.CLOUDFLARE_SCREENSHOT_URL;
		const apiKey = process.env.CLOUDFLARE_SCREENSHOT_KEY;

		if (!workerUrl || !apiKey) {
			await ctx.runMutation(internal.screenshots.setFailed, {
				itemId: args.itemId,
				error: 'Screenshot service not configured'
			});
			return;
		}

		const exists: boolean = await ctx.runQuery(internal.screenshots.itemExists, {
			itemId: args.itemId
		});
		if (!exists) return;

		let response: Response;
		try {
			response = await fetch(workerUrl, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${apiKey}`
				},
				body: JSON.stringify({
					url: args.url,
					itemId: args.itemId,
					mode: args.mode ?? 'screenshot'
				}),
				signal: AbortSignal.timeout(WORKER_TIMEOUT_MS)
			});
		} catch (error) {
			// A hung worker would hang again; don't hold the single-slot pool for retries
			if ((error as Error | undefined)?.name === 'TimeoutError') {
				throw new NonRetryableError('Screenshot service timed out');
			}
			// Worker unreachable - throw so the workpool retries; onScreenshotComplete
			// records the failure if retries run out
			throw new Error(
				`Screenshot service unreachable: ${error instanceof Error ? error.message : 'Unknown error'}`,
				{ cause: error }
			);
		}

		// Browser Rendering rate limit - throw so the workpool retries with backoff
		if (response.status === 429) {
			throw new Error(`Screenshot service rate limited: ${await response.text()}`);
		}

		if (!response.ok) {
			const errorText = await response.text();
			await ctx.runMutation(internal.screenshots.setFailed, {
				itemId: args.itemId,
				error: `Screenshot service error: ${response.status} - ${errorText}`
			});
			return;
		}

		const result = (await response.json()) as {
			imageKey: string;
			width: number;
			height: number;
			title?: string;
			description?: string;
			fonts?: unknown;
		};

		await ctx.runMutation(internal.screenshots.setCompleted, {
			itemId: args.itemId,
			imageKey: result.imageKey,
			imageWidth: result.width,
			imageHeight: result.height,
			title: result.title,
			description: result.description,
			fonts: parseSiteFonts(result.fonts)
		});
	}
});

// Runs after a pool job fails or is canceled (success is recorded by the
// action itself), so an item whose retries ran out never stays pending
export const onScreenshotComplete = internalMutation({
	args: vOnCompleteArgs(v.object({ itemId: v.id('items') })),
	handler: async (ctx, args) => {
		const item = await ctx.db.get(args.context.itemId);
		if (item?.screenshotStatus !== 'pending') return;
		await settleFailed(ctx, item, args.result.kind === 'failed' ? args.result.error : 'Canceled');
	}
});
