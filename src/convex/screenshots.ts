import { v } from 'convex/values';
import { internalAction, internalMutation } from './_generated/server';
import { internal } from './_generated/api';
import { authedMutation } from './lib/auth';
import { r2 } from './r2';
import { buildSearchText } from './lib/searchText';
import { linkImageModeValidator } from './schema';

export const setProcessing = internalMutation({
	args: { itemId: v.id('items') },
	handler: async (ctx, args) => {
		const item = await ctx.db.get(args.itemId);
		if (!item) return;

		await ctx.db.patch(args.itemId, {
			screenshotStatus: 'processing'
		});
	}
});

export const setCompleted = internalMutation({
	args: {
		itemId: v.id('items'),
		imageKey: v.string(),
		imageWidth: v.number(),
		imageHeight: v.number(),
		title: v.optional(v.string()),
		description: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const item = await ctx.db.get(args.itemId);
		if (!item) return;

		if (item.imageKey && item.imageKey !== args.imageKey) {
			await r2.deleteObject(ctx, item.imageKey);
		}

		// Only fill title/description the user hasn't written themselves
		const shouldSetTitle = !item.title && args.title;
		const shouldSetDescription = !item.description && args.description;
		const wantsTagging = item.taggingMode !== 'none';

		await ctx.db.patch(args.itemId, {
			screenshotStatus: 'completed',
			imageKey: args.imageKey,
			imageWidth: args.imageWidth,
			imageHeight: args.imageHeight,
			screenshotError: undefined,
			...(wantsTagging && { taggingStatus: 'pending' as const, taggingError: undefined }),
			...(shouldSetTitle && { title: args.title }),
			...(shouldSetDescription && { description: args.description }),
			...((shouldSetTitle || shouldSetDescription) && {
				searchText: buildSearchText({
					title: shouldSetTitle ? args.title : item.title,
					description: shouldSetDescription ? args.description : item.description,
					url: item.url,
					styles: item.styles,
					aiTags: item.aiTags,
					subject: item.subject,
					paletteNames: item.paletteNames
				})
			})
		});

		// Palette runs on every new image; the LLM tagger only when tagging is on
		await ctx.scheduler.runAfter(
			0,
			wantsTagging ? internal.taggingActions.preprocessItem : internal.taggingActions.repaletteItem,
			{ itemId: args.itemId }
		);
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
			screenshotStatus: 'failed',
			screenshotError: args.error
		});
	}
});

// Re-fetch a URL item's image, switching to the given mode; omitting the mode
// refreshes in the item's current one (e.g. retrying a failed capture)
export const reimageItem = authedMutation({
	args: {
		itemId: v.id('items'),
		mode: v.optional(linkImageModeValidator)
	},
	handler: async (ctx, args) => {
		const item = await ctx.db.get(args.itemId);
		if (!item) throw new Error('Item not found');
		if (item.type !== 'url' || !item.url) {
			throw new Error('Item is not a URL item');
		}
		if (item.screenshotStatus === 'pending' || item.screenshotStatus === 'processing') {
			throw new Error('Image fetch already in progress');
		}
		// A tagging job holds a reference to the current image; replacing the
		// image underneath it would let its stale results land afterwards
		if (item.taggingStatus === 'pending' || item.taggingStatus === 'processing') {
			throw new Error('Tagging in progress; wait for it to finish');
		}

		const mode = args.mode ?? item.linkImageMode;
		await ctx.db.patch(args.itemId, {
			linkImageMode: mode,
			screenshotStatus: 'pending',
			screenshotError: undefined
		});

		await ctx.scheduler.runAfter(0, internal.screenshots.generateScreenshotInternal, {
			itemId: args.itemId,
			url: item.url,
			mode
		});
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

		await ctx.runMutation(internal.screenshots.setProcessing, {
			itemId: args.itemId
		});

		try {
			const response = await fetch(workerUrl, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${apiKey}`
				},
				body: JSON.stringify({
					url: args.url,
					itemId: args.itemId,
					mode: args.mode ?? 'screenshot'
				})
			});

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(`Screenshot service error: ${response.status} - ${errorText}`);
			}

			const result = (await response.json()) as {
				imageKey: string;
				width: number;
				height: number;
				title?: string;
				description?: string;
			};

			await ctx.runMutation(internal.screenshots.setCompleted, {
				itemId: args.itemId,
				imageKey: result.imageKey,
				imageWidth: result.width,
				imageHeight: result.height,
				title: result.title,
				description: result.description
			});
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : 'Unknown error';

			await ctx.runMutation(internal.screenshots.setFailed, {
				itemId: args.itemId,
				error: errorMessage
			});
		}
	}
});
