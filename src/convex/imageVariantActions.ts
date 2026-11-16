'use node';

import { v } from 'convex/values';
import sharp from 'sharp';
import { internal } from './_generated/api';
import { internalAction } from './_generated/server';
import { variantKey, variantWidthsFor, type ImageVariant } from './lib/imageVariants';
import { r2, signUpload } from './r2';

const FETCH_TIMEOUT_MS = 30_000;
// WebP's limit on either side; a very tall image gets a narrower copy
const MAX_WEBP_SIDE = 16383;
// Animation is kept up to this many pixels across all frames, past which a
// copy is the first frame only (decoding every frame of a long GIF is costly)
const MAX_ANIMATED_PIXELS = 50_000_000;
const QUALITY = 80;

// Makes the item's image variants (lib/imageVariants.ts) and records them.
// An image that won't decode, or is gone, gets none: it's shown as it is.
export const makeVariants = internalAction({
	args: { itemId: v.id('items') },
	handler: async (ctx, { itemId }): Promise<void> => {
		const job = await ctx.runQuery(internal.imageVariants.variantJob, { itemId });
		if (!job) return;
		const { imageKey } = job;

		// From the bucket, not the public domain, whose edge cache would then hold it
		const response = await fetch(await r2.getUrl(imageKey), {
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
		});
		// Thrown, so the pool retries; a missing object won't come back
		if (!response.ok && response.status !== 404) {
			throw new Error(`image fetch failed: ${response.status}`);
		}

		let resized: Awaited<ReturnType<typeof makeCopies>> | undefined;
		if (response.ok) {
			try {
				resized = await makeCopies(Buffer.from(await response.arrayBuffer()));
			} catch (error) {
				console.warn(`makeVariants ${itemId}: ${imageKey} didn't decode:`, error);
			}
		}

		const variants: ImageVariant[] = [];
		try {
			for (const copy of resized?.copies ?? []) {
				const key = variantKey(itemId, copy.width);
				const upload = await fetch(await signUpload(key, 'image/webp'), {
					method: 'PUT',
					headers: { 'Content-Type': 'image/webp' },
					body: new Uint8Array(copy.data)
				});
				if (!upload.ok) throw new Error(`variant upload failed: ${upload.status}`);
				variants.push({ key, width: copy.width });
			}
		} catch (error) {
			// The pool retries the whole run, so what this one stored is dropped
			await ctx.runMutation(internal.imageVariants.discardVariants, { variants });
			throw error;
		}

		await ctx.runMutation(internal.imageVariants.saveVariants, {
			itemId,
			imageKey,
			variants,
			width: resized?.width,
			height: resized?.height
		});
	}
});

const fitWidth = (width: number) =>
	({ width, height: MAX_WEBP_SIDE, fit: 'inside', withoutEnlargement: true }) as const;

// The original's upright size and its WebP copies, narrowest first
export async function makeCopies(data: Buffer) {
	const meta = await sharp(data).metadata();
	const { width, height } = meta.autoOrient;
	const widths = variantWidthsFor(width);
	if (widths.length === 0) return { width, height, copies: [] };

	const pages = meta.pages ?? 1;
	const animated = pages > 1 && width * height * pages <= MAX_ANIMATED_PIXELS;
	const source = animated
		? sharp(data, { animated }).autoOrient()
		: await decodedAt(data, widths.at(-1)!);

	const copies = [];
	for (const target of widths) {
		const { data: out, info } = await source
			.clone()
			.resize(fitWidth(target))
			.webp({ quality: QUALITY })
			.toBuffer({ resolveWithObject: true });
		copies.push({ data: out, width: info.width });
		// Held to the height limit: a wider target would come out the same
		if (info.width < target) break;
	}
	return { width, height, copies };
}

// A still image decoded once, upright, at the widest copy's size, for every
// copy to be made from: decoding a large original is most of the time and
// memory a run takes (an 8000px PNG peaked near 1 GB decoded per copy, ~350 MB
// this way). Raw pixels would drop an animation's frame timing, so animations
// are read from the original for each copy instead.
async function decodedAt(data: Buffer, width: number) {
	const { data: pixels, info } = await sharp(data)
		.autoOrient()
		.resize(fitWidth(width))
		.raw()
		.toBuffer({ resolveWithObject: true });
	const { channels } = info;
	return sharp(pixels, { raw: { width: info.width, height: info.height, channels } });
}
