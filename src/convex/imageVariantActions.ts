'use node';

import { v } from 'convex/values';
import sharp, { type Sharp } from 'sharp';
import { internal } from './_generated/api';
import { internalAction } from './_generated/server';
import {
	HEAVY_BYTES_PER_PIXEL,
	MAX_IMAGE_PIXELS,
	pixelLimit,
	MAX_ORIGINAL_BYTES,
	MAX_ORIGINAL_WIDTH,
	boundedWidth,
	replacementKey,
	variantKey,
	variantWidthsFor,
	type ImageVariant
} from './lib/imageVariants';
import { r2, signUpload } from './r2';

// Node actions get 512 MB, and libvips' operation cache and per-thread buffers
// add to every run's memory: one thread and no cache keep the worst image
// allowed in well under, at some speed (still seconds, in the background).
sharp.cache(false);
sharp.concurrency(1);

const FETCH_TIMEOUT_MS = 30_000;

// Copies and replaced originals are WebP at quality 90, copies with sharp YUV:
// lossy WebP keeps color at half resolution, which otherwise smears colored
// text. AVIF measured a little better for fewer bytes, but encodes ~9x slower
// and needs several times the memory (reference/image-variants.md).
const encode = (s: Sharp, smartSubsample = true) => s.webp({ quality: 90, smartSubsample });

// The most pixels a run encodes at once, so that no image allowed in
// (MAX_IMAGE_PIXELS, 30 MB) takes it past a Node action's 512 MB. A bigger copy
// or replacement (a very tall image) comes out narrower.
const MAX_ENCODE_PIXELS = 10_000_000;

// Makes the item's image variants (lib/imageVariants.ts), replacing an
// oversized original on the way, and records them. An image that won't decode,
// is over the pixel limit, or is gone, gets none: it's shown as it is.
export const makeVariants = internalAction({
	args: { itemId: v.id('items') },
	handler: async (ctx, { itemId }): Promise<void> => {
		const imageKey = await ctx.runQuery(internal.imageVariants.variantJob, { itemId });
		if (!imageKey) return;

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
				console.warn(`makeVariants ${itemId}: ${imageKey} wasn't processed:`, error);
			}
		}

		const uploads: { key: string; data: Buffer }[] = [];
		let original;
		const replacement = processed?.replacement;
		if (replacement) {
			const key = replacementKey(itemId);
			uploads.push({ key, data: replacement.data });
			original = { key, width: replacement.width, height: replacement.height };
		}
		const variants: ImageVariant[] = (processed?.copies ?? []).map((copy) => {
			const key = variantKey(itemId, copy.width);
			uploads.push({ key, data: copy.data });
			return { key, width: copy.width };
		});

		const results = await Promise.allSettled(uploads.map(({ key, data }) => put(key, data)));
		const failed = results.find((result) => result.status === 'rejected');
		if (failed) {
			// The pool retries the whole run, so what this one stored is dropped
			const stored = uploads.filter((_, i) => results[i].status === 'fulfilled');
			await ctx.runMutation(internal.imageVariants.deleteObjects, {
				keys: stored.map(({ key }) => key)
			});
			throw failed.reason;
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

async function put(key: string, data: Buffer) {
	const upload = await fetch(await signUpload(key, 'image/webp'), {
		method: 'PUT',
		headers: { 'Content-Type': 'image/webp' },
		body: new Uint8Array(data)
	});
	if (!upload.ok) throw new Error(`variant upload failed: ${upload.status}`);
}

// An image's header, refusing one over its format's pixel limit before
// anything decodes it
async function header(data: Buffer) {
	const meta = await sharp(data).metadata();
	if (meta.width * meta.height > pixelLimit(meta.format)) {
		throw new Error(`over the pixel limit: ${meta.format} ${meta.width}x${meta.height}`);
	}
	return meta;
}

const read = (data: Buffer, animated = false) =>
	sharp(data, { animated, limitInputPixels: MAX_IMAGE_PIXELS }).autoOrient();

// Shrink-on-load (decoding a JPEG or WebP at a fraction of its size) is
// faster but can leave moiré in fine patterns
const toWidth = (width: number) => ({ width, fastShrinkOnLoad: false });

// The image's upright size, a replacement if it's oversized, and its
// copies (made from the replacement, if any), narrowest first
export async function processImage(data: Buffer) {
	const replacement = await replaceOriginal(data);
	const { width, height, copies } = await makeCopies(replacement?.data ?? data);
	return { width, height, replacement, copies };
}

// A still original wider than MAX_ORIGINAL_WIDTH or heavier than
// MAX_ORIGINAL_BYTES as a WebP within those (and MAX_ENCODE_PIXELS),
// upright, keeping its color profile and none of its other metadata; or null.
// Unlike the copies it decodes with shrink-on-load and skips sharp YUV: this is
// the run's biggest decode and encode, and both keep it well inside 512 MB
async function replaceOriginal(data: Buffer) {
	const meta = await header(data);
	const { width, height } = meta.autoOrient;
	const oversized = width > MAX_ORIGINAL_WIDTH || data.length > MAX_ORIGINAL_BYTES;
	if (!oversized || (meta.pages ?? 1) > 1) return null;
	const target = boundedWidth(width, height, MAX_ORIGINAL_WIDTH, MAX_ENCODE_PIXELS);
	const { data: out, info } = await encode(
		read(data).resize({ width: target }).keepIccProfile(),
		false
	).toBuffer({ resolveWithObject: true });
	if (out.length >= data.length) return null;
	return { data: out, width: info.width, height: info.height };
}

// The image's upright size and its copies, narrowest first
export async function makeCopies(data: Buffer) {
	const meta = await header(data);
	const { width, height } = meta.autoOrient;
	const pages = meta.pages ?? 1;
	const widths = variantWidthsFor(
		width,
		data.length / (width * height * pages) > HEAVY_BYTES_PER_PIXEL
	);
	// Animated while every frame together is within the input limit; past it,
	// a copy is the first frame
	const animated = pages > 1 && width * height * pages <= MAX_IMAGE_PIXELS;
	const frames = animated ? pages : 1;

	const copies = [];
	for (const target of widths) {
		const copyWidth = boundedWidth(width, height, target, MAX_ENCODE_PIXELS / frames);
		const { data: out, info } = await encode(
			read(data, animated)
				.resize(toWidth(copyWidth))
				// A P3 image stays P3: converted to sRGB it looks duller on a P3 screen
				.keepIccProfile()
		).toBuffer({ resolveWithObject: true });
		copies.push({ data: out, width: info.width });
		// Held to a size limit: a wider target would come out the same
		if (copyWidth < Math.min(target, width)) break;
	}
	return { width, height, copies };
}
