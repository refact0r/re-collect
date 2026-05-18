import { v } from 'convex/values';
import { internalAction, internalMutation, mutation } from './_generated/server';
import { internal } from './_generated/api';
import { requireAuth } from './auth';
import { r2 } from './r2';
import { buildSearchText } from './searchText';

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
		title: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const item = await ctx.db.get(args.itemId);
		if (!item) return;

		if (item.imageKey && item.imageKey !== args.imageKey) {
			await r2.deleteObject(ctx, item.imageKey);
		}

		const shouldSetTitle = !item.title && args.title;
		const newTitle = shouldSetTitle ? args.title : item.title;

		await ctx.db.patch(args.itemId, {
			screenshotStatus: 'completed',
			imageKey: args.imageKey,
			imageWidth: args.imageWidth,
			imageHeight: args.imageHeight,
			screenshotError: undefined,
			taggingStatus: 'pending',
			taggingError: undefined,
			...(shouldSetTitle && {
				title: args.title,
				searchText: buildSearchText({
					title: newTitle,
					description: item.description,
					url: item.url,
					styles: item.styles,
					aiTags: item.aiTags,
					subject: item.subject,
					paletteDescription: item.paletteDescription
				})
			})
		});

		await ctx.scheduler.runAfter(0, internal.taggingActions.preprocessItem, {
			itemId: args.itemId
		});
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

export const generateScreenshot = internalAction({
	args: {
		itemId: v.id('items'),
		url: v.string()
	},
	handler: async (ctx, args): Promise<void> => {
		await ctx.runAction(internal.screenshots.generateScreenshotInternal, {
			itemId: args.itemId,
			url: args.url
		});
	}
});

export const retryScreenshot = mutation({
	args: { itemId: v.id('items'), token: v.optional(v.string()) },
	handler: async (ctx, args) => {
		requireAuth(args.token);
		const item = await ctx.db.get(args.itemId);
		if (!item) throw new Error('Item not found');
		if (item.type !== 'url' || !item.url) {
			throw new Error('Item is not a URL item');
		}
		if (item.screenshotStatus !== 'failed') {
			throw new Error('Screenshot is not in failed state');
		}

		await ctx.db.patch(args.itemId, {
			screenshotStatus: 'pending',
			screenshotError: undefined
		});

		await ctx.scheduler.runAfter(0, internal.screenshots.generateScreenshotInternal, {
			itemId: args.itemId,
			url: item.url
		});
	}
});

export const generateScreenshotInternal = internalAction({
	args: {
		itemId: v.id('items'),
		url: v.string()
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
					itemId: args.itemId
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
			};

			await ctx.runMutation(internal.screenshots.setCompleted, {
				itemId: args.itemId,
				imageKey: result.imageKey,
				imageWidth: result.width,
				imageHeight: result.height,
				title: result.title
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
