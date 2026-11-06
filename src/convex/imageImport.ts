'use node';

import { v } from 'convex/values';
import sharp from 'sharp';
import { action } from './_generated/server';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { r2 } from './r2';

// Accepts http(s) and data: URLs
async function fetchImage(imageUrl: string, pageUrl?: string) {
	// Referer gets past basic hotlink protection on most CDNs
	const response = await fetch(imageUrl, { headers: pageUrl ? { Referer: pageUrl } : {} });
	if (!response.ok) throw new Error(`Image fetch failed: ${response.status}`);
	const contentType = response.headers.get('content-type') ?? '';
	if (!contentType.startsWith('image/')) throw new Error(`Not an image: ${contentType}`);

	const data = Buffer.from(await response.arrayBuffer());
	const { autoOrient } = await sharp(data).metadata();
	return { data, contentType, width: autoOrient.width, height: autoOrient.height };
}

// Saves a remote image (e.g. from the browser extension) as an image item.
// If the image can't be fetched, falls back to a URL item for its page.
export const addFromUrl = action({
	args: {
		imageUrl: v.string(),
		pageUrl: v.optional(v.string()),
		collections: v.optional(v.array(v.id('collections'))),
		token: v.optional(v.string())
	},
	returns: v.object({
		itemId: v.id('items'),
		type: v.union(v.literal('image'), v.literal('url'))
	}),
	handler: async (ctx, args): Promise<{ itemId: Id<'items'>; type: 'image' | 'url' }> => {
		const { imageUrl, pageUrl, collections, token } = args;
		// Check the caller before fetching anything; items.add re-checks on write
		await ctx.runQuery(api.users.me, { token });

		let image;
		try {
			image = await fetchImage(imageUrl, pageUrl);
		} catch (error) {
			if (!pageUrl) throw error;
			console.warn(`addFromUrl: ${imageUrl} failed, saving page instead:`, error);
			const itemId = await ctx.runMutation(api.items.add, {
				type: 'url',
				url: pageUrl,
				collections,
				token
			});
			return { itemId, type: 'url' };
		}

		const imageKey = await r2.store(ctx, image.data, { type: image.contentType });
		const itemId = await ctx.runMutation(api.items.add, {
			type: 'image',
			url: pageUrl,
			imageKey,
			imageWidth: image.width,
			imageHeight: image.height,
			collections,
			token
		});
		return { itemId, type: 'image' };
	}
});

// Saves a page as a URL item with an image captured client-side (the browser
// extension's screenshot, as a data: URL) in place of the worker's
export const addPageWithImage = action({
	args: {
		url: v.string(),
		title: v.optional(v.string()),
		ogDescription: v.optional(v.string()),
		imageUrl: v.string(),
		collections: v.optional(v.array(v.id('collections'))),
		token: v.optional(v.string())
	},
	returns: v.id('items'),
	handler: async (ctx, args): Promise<Id<'items'>> => {
		const { imageUrl, ...rest } = args;
		await ctx.runQuery(api.users.me, { token: args.token });

		const image = await fetchImage(imageUrl);
		const imageKey = await r2.store(ctx, image.data, { type: image.contentType });
		return await ctx.runMutation(api.items.add, {
			type: 'url',
			...rest,
			imageKey,
			imageWidth: image.width,
			imageHeight: image.height
		});
	}
});
