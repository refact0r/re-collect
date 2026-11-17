'use node';

import { ConvexError, v } from 'convex/values';
import sharp from 'sharp';
import { action, type ActionCtx } from './_generated/server';
import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { RASTER_IMAGE_TYPES } from './lib/images';
import { pixelLimit } from './lib/imageVariants';
import { isPublicWebUrl, isWebUrl } from './lib/urls';
import { r2 } from './r2';
import { taggingModeValidator } from './schema';

type Image = Awaited<ReturnType<typeof describeImage>>;

// Well under the ~30 s an extension service worker waits on a fetch, upload included
const FETCH_TIMEOUT_MS = 15_000;
const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
const MAX_REDIRECTS = 3;
// sharp's format names for the RASTER_IMAGE_TYPES (lib/images.ts). AVIF is
// HEIF with AV1 compression (HEIC, the other kind, doesn't show in browsers).
const RASTER_TYPES: Partial<Record<string, string>> = {
	jpeg: 'image/jpeg',
	png: 'image/png',
	webp: 'image/webp',
	gif: 'image/gif'
};

const notAnImage = () => new ConvexError('that is not a supported image');
const tooLarge = () => new ConvexError('the image is over 30 MB');
const tooManyPixels = (limit: number) =>
	new ConvexError(`the image is over ${limit / 1_000_000} megapixels`);

// Worth downloading: any declared image type but SVG, or untyped bytes. What
// gets stored is decided by the bytes.
function mayBeImage(declared: string) {
	return (
		(declared.startsWith('image/') && declared !== 'image/svg+xml') ||
		declared === 'application/octet-stream' ||
		declared === 'binary/octet-stream'
	);
}

async function describeImage(data: Buffer) {
	const { format, compression, autoOrient } = await sharp(data)
		.metadata()
		.catch(() => {
			throw notAnImage();
		});
	const contentType =
		format === 'heif' ? (compression === 'av1' ? 'image/avif' : undefined) : RASTER_TYPES[format];
	if (!contentType) throw notAnImage();
	const limit = pixelLimit(format);
	if (autoOrient.width * autoOrient.height > limit) throw tooManyPixels(limit);
	return { data, contentType, width: autoOrient.width, height: autoOrient.height };
}

// Fetches a public http(s) image, re-checking the address at each redirect,
// and throws on anything it won't fetch or store
export async function fetchImage(imageUrl: string, pageUrl?: string) {
	const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
	let url = imageUrl;
	let response: Response;
	for (let redirects = 0; ; redirects++) {
		if (!isPublicWebUrl(url)) throw new ConvexError("that image address can't be fetched");
		response = await fetch(url, {
			// Referer gets past basic hotlink protection on most CDNs
			headers: pageUrl ? { Referer: pageUrl } : {},
			redirect: 'manual',
			signal
		});
		const location = response.headers.get('location');
		if (response.status < 300 || response.status >= 400 || !location) break;
		if (redirects === MAX_REDIRECTS) throw new ConvexError('image fetch failed');
		await response.body?.cancel();
		url = new URL(location, url).href;
	}
	return await readImage(response, mayBeImage);
}

// A response's body as an image to store, if its declared type passes `accept`
async function readImage(response: Response, accept: (declared: string) => boolean) {
	if (!response.ok || !response.body) throw new ConvexError('image fetch failed');
	const declared = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
	if (!declared || !accept(declared)) throw notAnImage();
	if (Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES) throw tooLarge();

	// Streamed, so a body without a content-length can't run past the cap
	const chunks: Uint8Array[] = [];
	let size = 0;
	const reader = response.body.getReader();
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.length;
		if (size > MAX_IMAGE_BYTES) {
			await reader.cancel();
			throw tooLarge();
		}
		chunks.push(value);
	}
	return await describeImage(Buffer.concat(chunks));
}

// A base64 data: URL: the extension's own capture, or an inline image it saves
export async function decodeDataImage(dataUrl: string) {
	const match = /^data:[^,]*;base64,/i.exec(dataUrl);
	if (!match) throw notAnImage();
	const encoded = dataUrl.slice(match[0].length);
	// Checked before decoding: base64 is 4 characters per 3 bytes
	if ((encoded.length * 3) / 4 > MAX_IMAGE_BYTES) throw tooLarge();
	return await describeImage(Buffer.from(encoded, 'base64'));
}

const markVerified = (ctx: ActionCtx, key: string, { contentType, width, height }: Image) =>
	ctx.runMutation(internal.r2.markVerified, { key, contentType, width, height });

// Same path as the app's uploads, so the key gets the caller's `uploads` row
// that items.add requires; these bytes were checked already, so it's verified
export async function upload(ctx: ActionCtx, image: Image, token: string) {
	const { contentType } = image;
	const { url, key } = await ctx.runMutation(api.r2.generateUploadUrl, { contentType, token });
	const response = await fetch(url, {
		method: 'PUT',
		headers: { 'Content-Type': contentType },
		body: new Uint8Array(image.data)
	});
	if (!response.ok) throw new Error(`Image upload failed: ${response.status}`);
	await markVerified(ctx, key, image);
	return key;
}

// Checks the caller's own PUT to an r2.generateUploadUrl key, which items.add
// accepts only once this passes: the object must be served as a raster type
// (the signed URL already pins one) and its bytes must decode as one. A failed
// upload is deleted right away.
export const verifyUpload = action({
	args: { key: v.string(), token: v.string() },
	returns: v.null(),
	handler: async (ctx, { key, token }) => {
		if (!(await ctx.runQuery(internal.r2.pendingUpload, { key, token }))) {
			throw new ConvexError('upload not found');
		}
		try {
			// Read from the bucket, not the public domain, which may cache what it serves
			const response = await fetch(await r2.getUrl(key), {
				signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
			});
			const image = await readImage(response, (served) => RASTER_IMAGE_TYPES.includes(served));
			await markVerified(ctx, key, image);
		} catch (error) {
			await ctx.runMutation(internal.r2.discardUpload, { key });
			throw error;
		}
		return null;
	}
});

// Saves a remote image (e.g. from the browser extension) as an image item.
// If the image can't be fetched, falls back to a URL item for its page.
export const addFromUrl = action({
	args: {
		imageUrl: v.string(),
		pageUrl: v.optional(v.string()),
		collections: v.optional(v.array(v.id('collections'))),
		token: v.string()
	},
	returns: v.object({
		itemId: v.id('items'),
		type: v.union(v.literal('image'), v.literal('url'))
	}),
	handler: async (ctx, args): Promise<{ itemId: Id<'items'>; type: 'image' | 'url' }> => {
		const { imageUrl, collections, token } = args;
		// Check the caller before fetching anything; items.add re-checks on write
		await ctx.runQuery(internal.users.userForToken, { token });
		// A file:// or view-source: page is no item link, so it's neither the
		// image's source nor a fallback
		const pageUrl = args.pageUrl && isWebUrl(args.pageUrl) ? args.pageUrl : undefined;

		let image;
		try {
			image = imageUrl.startsWith('data:')
				? await decodeDataImage(imageUrl)
				: await fetchImage(imageUrl, pageUrl);
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

		const imageKey = await upload(ctx, image, token);
		const itemId = await ctx.runMutation(api.items.add, {
			type: 'image',
			url: pageUrl,
			imageKey,
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
		taggingMode: v.optional(taggingModeValidator),
		token: v.string()
	},
	returns: v.id('items'),
	handler: async (ctx, args): Promise<Id<'items'>> => {
		const { imageUrl, ...rest } = args;
		await ctx.runQuery(internal.users.userForToken, { token: args.token });
		// Checked before the upload, which items.add would otherwise leave behind
		if (!isWebUrl(args.url)) throw new ConvexError('links must start with http:// or https://');

		const imageKey = await upload(ctx, await decodeDataImage(imageUrl), args.token);
		return await ctx.runMutation(api.items.add, { type: 'url', ...rest, imageKey });
	}
});
