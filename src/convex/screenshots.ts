import { v } from 'convex/values';
import { internalAction, internalMutation, mutation } from './_generated/server';
import { internal } from './_generated/api';

// Internal mutation to update screenshot status to processing
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

// Internal mutation to mark screenshot as completed with image data
export const setCompleted = internalMutation({
	args: {
		itemId: v.id('items'),
		imageKey: v.string(),
		imageWidth: v.number(),
		imageHeight: v.number()
	},
	handler: async (ctx, args) => {
		const item = await ctx.db.get(args.itemId);
		if (!item) return;

		await ctx.db.patch(args.itemId, {
			screenshotStatus: 'completed',
			imageKey: args.imageKey,
			imageWidth: args.imageWidth,
			imageHeight: args.imageHeight,
			screenshotError: undefined
		});
	}
});

// Internal mutation to mark screenshot as failed
export const setFailed = internalMutation({
	args: {
		itemId: v.id('items'),
		error: v.string(),
		retries: v.number()
	},
	handler: async (ctx, args) => {
		const item = await ctx.db.get(args.itemId);
		if (!item) return;

		await ctx.db.patch(args.itemId, {
			screenshotStatus: 'failed',
			screenshotError: args.error,
			screenshotRetries: args.retries
		});
	}
});

// Internal action to generate screenshot via Cloudflare Worker
// Delegates to generateScreenshotInternal with retryCount: 0
export const generateScreenshot = internalAction({
	args: {
		itemId: v.id('items'),
		url: v.string()
	},
	handler: async (ctx, args): Promise<void> => {
		await ctx.runAction(internal.screenshots.generateScreenshotInternal, {
			itemId: args.itemId,
			url: args.url,
			retryCount: 0
		});
	}
});

// Public mutation to retry a failed screenshot
export const retryScreenshot = mutation({
	args: { itemId: v.id('items') },
	handler: async (ctx, args) => {
		const item = await ctx.db.get(args.itemId);
		if (!item) throw new Error('Item not found');
		if (item.type !== 'url' || !item.url) {
			throw new Error('Item is not a URL item');
		}
		if (item.screenshotStatus !== 'failed') {
			throw new Error('Screenshot is not in failed state');
		}

		const retries = (item.screenshotRetries ?? 0) + 1;

		// Reset to pending and schedule screenshot generation
		await ctx.db.patch(args.itemId, {
			screenshotStatus: 'pending',
			screenshotError: undefined,
			screenshotRetries: retries
		});

		// Schedule the action
		await ctx.scheduler.runAfter(0, internal.screenshots.generateScreenshotInternal, {
			itemId: args.itemId,
			url: item.url,
			retryCount: retries
		});
	}
});

// Internal action for retry with retry count tracking
export const generateScreenshotInternal = internalAction({
	args: {
		itemId: v.id('items'),
		url: v.string(),
		retryCount: v.number()
	},
	handler: async (ctx, args): Promise<void> => {
		const workerUrl = process.env.CLOUDFLARE_SCREENSHOT_URL;
		const apiKey = process.env.CLOUDFLARE_SCREENSHOT_KEY;

		if (!workerUrl || !apiKey) {
			await ctx.runMutation(internal.screenshots.setFailed, {
				itemId: args.itemId,
				error: 'Screenshot service not configured',
				retries: args.retryCount
			});
			return;
		}

		// Update status to processing
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
			};

			// Update item with screenshot data
			await ctx.runMutation(internal.screenshots.setCompleted, {
				itemId: args.itemId,
				imageKey: result.imageKey,
				imageWidth: result.width,
				imageHeight: result.height
			});
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : 'Unknown error';

			await ctx.runMutation(internal.screenshots.setFailed, {
				itemId: args.itemId,
				error: errorMessage,
				retries: args.retryCount
			});
		}
	}
});
