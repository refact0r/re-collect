'use node';

import { v } from 'convex/values';
import sharp, { type Sharp } from 'sharp';
import { internal } from './_generated/api';
import { internalAction } from './_generated/server';
import {
	HEAVY_BYTES_PER_PIXEL,
	MAX_ORIGINAL_WIDTH,
	cappedKey,
	variantKey,
	variantWidthsFor,
	type ImageVariant
} from './lib/imageVariants';
import { r2, signUpload } from './r2';

// Node actions get 512 MB, which the biggest originals went past on prod:
// libvips' operation cache and per-thread buffers (AVIF encoding most) took a
// run to ~375 MB on top of the runtime's own. One thread and no cache keep it
// under ~250 MB, at about three times the time (still seconds, in the
// background).
sharp.cache(false);
sharp.concurrency(1);

const FETCH_TIMEOUT_MS = 30_000;
// WebP's limit on either side (and within AVIF's); a very tall image gets a
// narrower copy
const MAX_SIDE = 16383;
// Animation is kept up to this many pixels across all frames, past which a
// copy is the first frame only (decoding every frame of a long GIF is costly)
const MAX_ANIMATED_PIXELS = 50_000_000;

// Copies are AVIF with full-resolution color: smaller than WebP at quality 80
// and without its half-resolution color, which smears colored text
// (reference/image-variants.md has the measurements). sharp can't write an
// animated AVIF, so animations stay WebP.
const COPY_FORMATS = {
	still: {
		contentType: 'image/avif',
		ext: 'avif',
		encode: (s: Sharp) => s.avif({ quality: 60, chromaSubsampling: '4:4:4' })
	},
	animated: {
		contentType: 'image/webp',
		ext: 'webp',
		encode: (s: Sharp) => s.webp({ quality: 90, smartSubsample: true })
	}
};

// How an oversized original is re-encoded: its own format, at high quality.
// Animations and AVIF are left as they came.
const CAPPED_FORMATS = {
	jpeg: {
		contentType: 'image/jpeg',
		ext: 'jpg',
		encode: (s: Sharp) => s.jpeg({ quality: 92, mozjpeg: true })
	},
	png: { contentType: 'image/png', ext: 'png', encode: (s: Sharp) => s.png() },
	webp: {
		contentType: 'image/webp',
		ext: 'webp',
		encode: (s: Sharp) => s.webp({ quality: 92 })
	}
};

// Makes the item's image variants (lib/imageVariants.ts), capping an oversized
// original on the way, and records them. An image that won't decode, or is
// gone, gets none: it's shown as it is.
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

		let processed: Awaited<ReturnType<typeof processImage>> | undefined;
		if (response.ok) {
			try {
				processed = await processImage(Buffer.from(await response.arrayBuffer()));
			} catch (error) {
				console.warn(`makeVariants ${itemId}: ${imageKey} didn't decode:`, error);
			}
		}

		const stored: string[] = [];
		const put = async (key: string, contentType: string, data: Buffer) => {
			const upload = await fetch(await signUpload(key, contentType), {
				method: 'PUT',
				headers: { 'Content-Type': contentType },
				body: new Uint8Array(data)
			});
			if (!upload.ok) throw new Error(`variant upload failed: ${upload.status}`);
			stored.push(key);
		};

		const variants: ImageVariant[] = [];
		let original;
		try {
			const capped = processed?.capped;
			if (capped) {
				const key = cappedKey(itemId, capped.ext);
				await put(key, capped.contentType, capped.data);
				original = { key, width: capped.width, height: capped.height };
			}
			for (const copy of processed?.copies ?? []) {
				const key = variantKey(itemId, copy.width, copy.ext);
				await put(key, copy.contentType, copy.data);
				variants.push({ key, width: copy.width });
			}
		} catch (error) {
			// The pool retries the whole run, so what this one stored is dropped
			await ctx.runMutation(internal.imageVariants.deleteObjects, { keys: stored });
			throw error;
		}

		await ctx.runMutation(internal.imageVariants.saveVariants, {
			itemId,
			imageKey,
			variants,
			original,
			width: processed?.width,
			height: processed?.height
		});
	}
});

// Shrink-on-load (decoding a JPEG or WebP at a fraction of its size) is
// faster but can leave moiré in fine patterns
const fitWidth = (width: number) =>
	({
		width,
		height: MAX_SIDE,
		fit: 'inside',
		withoutEnlargement: true,
		fastShrinkOnLoad: false
	}) as const;

// The image's upright size, a capped replacement if it's oversized, and its
// WebP copies (made from the capped one, if any), narrowest first
export async function processImage(data: Buffer) {
	const capped = await capOriginal(data);
	const { width, height, copies } = await makeCopies(capped?.data ?? data);
	return { width, height, capped, copies };
}

// An original wider than MAX_ORIGINAL_WIDTH at that width, upright, keeping
// its color profile (and nothing else of its metadata), or null
async function capOriginal(data: Buffer) {
	const meta = await sharp(data).metadata();
	const format = CAPPED_FORMATS[meta.format as keyof typeof CAPPED_FORMATS];
	if (!format || (meta.pages ?? 1) > 1 || meta.autoOrient.width <= MAX_ORIGINAL_WIDTH) return null;
	const { data: out, info } = await format
		.encode(sharp(data).autoOrient().resize(fitWidth(MAX_ORIGINAL_WIDTH)).keepIccProfile())
		.toBuffer({ resolveWithObject: true });
	return { ...format, data: out, width: info.width, height: info.height };
}

// The image's upright size and its copies, narrowest first
export async function makeCopies(data: Buffer) {
	const meta = await sharp(data).metadata();
	const { width, height } = meta.autoOrient;
	const pages = meta.pages ?? 1;
	const widths = variantWidthsFor(
		width,
		data.length / (width * height * pages) > HEAVY_BYTES_PER_PIXEL
	);
	if (widths.length === 0) return { width, height, copies: [] };

	const animated = pages > 1 && width * height * pages <= MAX_ANIMATED_PIXELS;
	const format = animated ? COPY_FORMATS.animated : COPY_FORMATS.still;

	const copies = [];
	for (const target of widths) {
		const { data: out, info } = await format
			.encode(
				sharp(data, { animated })
					.autoOrient()
					.resize(fitWidth(target))
					// A P3 image stays P3: converted to sRGB it looks duller on a P3 screen
					.keepIccProfile()
			)
			.toBuffer({ resolveWithObject: true });
		copies.push({ ...format, data: out, width: info.width });
		// Held to the height limit: a wider target would come out the same
		if (info.width < target) break;
	}
	return { width, height, copies };
}
