'use node';

import { v } from 'convex/values';
import { NonRetryableError } from '@convex-dev/workpool';
import sharp from 'sharp';
import { parseHTML } from 'linkedom';
import Defuddle from 'defuddle';
import { extractPalette, validateOptions, MmcqQuantizer } from 'colorthief/internals';
import { internalAction, type ActionCtx } from './_generated/server';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { requestArticleTags, requestImageTags, type TagResult } from './lib/tagger';
import { RetryableError, embeddingToMake, embedImage, embedText } from './lib/embedder';

// Every tagging, palette and embedding job runs here, in the Node runtime: sharp
// needs it, and its 512MB comfortably fits a decoded image or a parsed 4MB page

// Node actions get 512 MB: without libvips' operation cache and with one
// thread, decoding the biggest image allowed in fits (palette runs ran out of
// memory on them otherwise)
sharp.cache(false);
sharp.concurrency(1);

const MAX_EDGE_PX = 1024;
const PALETTE_COLORS = 5;
// Color Thief's stride; samples every Nth pixel of the raw RGBA buffer.
const PALETTE_SAMPLE_STRIDE = 10;

const mmcqQuantizer = new MmcqQuantizer();

// Pick K dominant colors via Color Thief's MMCQ (recursive RGB median-cut
// with a two-phase priority queue). Captures distinct color clusters well —
// small accents survive Phase 2's count×volume splitting — at the cost of
// occasionally producing phantom swatches in empty regions of color space
// on images with widely-separated clusters.
function extractPalettePeaks(data: Buffer, width: number, height: number, k: number): string[] {
	const opts = validateOptions({
		colorCount: k,
		quality: PALETTE_SAMPLE_STRIDE,
		ignoreWhite: false,
		colorSpace: 'rgb'
	});
	const palette = extractPalette(data, width, height, opts, mmcqQuantizer);
	return palette
		? [...palette].sort((a, b) => b.population - a.population).map((c) => c.hex())
		: [];
}

async function fetchAndDecode(imageKey: string): Promise<{
	data: Buffer;
	width: number;
	height: number;
}> {
	const publicBase = process.env.R2_PUBLIC_URL;
	if (!publicBase) throw new Error('R2_PUBLIC_URL not configured');

	const response = await fetch(`${publicBase}/${imageKey}`);
	if (!response.ok) {
		throw new Error(`R2 fetch failed: ${response.status}`);
	}
	const buf = Buffer.from(await response.arrayBuffer());

	const { data, info } = await sharp(buf)
		.rotate()
		.resize({ width: MAX_EDGE_PX, height: MAX_EDGE_PX, fit: 'inside', withoutEnlargement: true })
		.raw()
		.ensureAlpha()
		.toBuffer({ resolveWithObject: true });

	return { data, width: info.width, height: info.height };
}

// The decoded image as the JPEG the tagger and embedder are sent. JPEG has no
// alpha: without flattening, transparent pixels turn black.
async function toJpegBase64(data: Buffer, width: number, height: number): Promise<string> {
	const jpeg = await sharp(data, { raw: { width, height, channels: 4 } })
		.flatten({ background: '#ffffff' })
		.jpeg({ quality: 85 })
		.toBuffer();
	return jpeg.toString('base64');
}

// Article extraction limits
const FETCH_TIMEOUT_MS = 15_000;
const MAX_HTML_CHARS = 4_000_000; // parser input cap for pathological pages
const MAX_ARTICLE_CHARS = 8_000; // ~2k tokens sent to the LLM
const MIN_ARTICLE_CHARS = 200; // below this, extraction is considered failed

// Same browser-like headers the screenshot worker uses for its no-browser path
const FETCH_HEADERS = {
	'User-Agent':
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
	'Accept-Language': 'en-US,en;q=0.9',
	Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
};

// Reads the body only up to maxChars, so a huge page is never buffered whole
async function readTextCapped(response: Response, maxChars: number): Promise<string> {
	const reader = response.body?.getReader();
	if (!reader) return '';
	const decoder = new TextDecoder();
	let text = '';
	while (text.length < maxChars) {
		const { done, value } = await reader.read();
		if (done) return text + decoder.decode();
		text += decoder.decode(value, { stream: true });
	}
	await reader.cancel();
	return text.slice(0, maxChars);
}

// Fetch a page and extract its readable article text. Plain fetch + Defuddle —
// no browser involved, so this never touches the Browser Rendering quota.
async function extractArticleText(url: string): Promise<{ title?: string; text: string }> {
	const response = await fetch(url, {
		headers: FETCH_HEADERS,
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
	});
	if (!response.ok) {
		throw new Error(`Page fetch failed: ${response.status}`);
	}
	const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
	if (contentType !== 'text/html' && contentType !== 'application/xhtml+xml') {
		throw new Error(`Not an HTML page (${contentType ?? 'unknown content type'})`);
	}

	const html = await readTextCapped(response, MAX_HTML_CHARS);
	const { document } = parseHTML(html);
	const result = new Defuddle(document, { url: response.url || url }).parse();

	// Defuddle returns cleaned content HTML; strip to plain text via a reparse
	const { document: contentDoc } = parseHTML(`<html><body>${result.content}</body></html>`);
	const text = (contentDoc.body?.textContent ?? '').replace(/\s+/g, ' ').trim();
	if (text.length < MIN_ARTICLE_CHARS) {
		throw new Error('Could not extract article text from page');
	}

	return { title: result.title || undefined, text: text.slice(0, MAX_ARTICLE_CHARS) };
}

function getItem(ctx: ActionCtx, itemId: Id<'items'>): Promise<Doc<'items'> | null> {
	return ctx.runQuery(internal.tagging.getItemForTagging, { itemId });
}

// Runs one tagging job to its outcome: whatever `tag` throws (missing input or
// config, a fetch, the LLM) marks the item failed
async function runTagging(
	ctx: ActionCtx,
	itemId: Id<'items'>,
	tag: (item: Doc<'items'>) => Promise<TagResult>
): Promise<void> {
	const item = await getItem(ctx, itemId);
	if (!item) return;
	try {
		await ctx.runMutation(internal.tagging.setCompleted, { itemId, ...(await tag(item)) });
	} catch (error) {
		await ctx.runMutation(internal.tagging.setFailed, {
			itemId,
			error: error instanceof Error ? error.message : 'Unknown error'
		});
	}
}

export const repaletteItem = internalAction({
	args: { itemId: v.id('items') },
	handler: async (ctx, args): Promise<void> => {
		const item = await getItem(ctx, args.itemId);
		if (!item?.imageKey) return;

		try {
			const { data, width, height } = await fetchAndDecode(item.imageKey);
			const paletteHex = extractPalettePeaks(data, width, height, PALETTE_COLORS);
			await ctx.runMutation(internal.tagging.setPaletteHex, {
				itemId: args.itemId,
				paletteHex
			});
		} catch (error) {
			console.error(`repaletteItem ${args.itemId} failed:`, error);
		}
	}
});

// Visual mode: palette + LLM tags from the item's image, decoded once
export const tagImageItem = internalAction({
	args: { itemId: v.id('items') },
	handler: async (ctx, { itemId }): Promise<void> => {
		await runTagging(ctx, itemId, async (item) => {
			if (item.type === 'text' || !item.imageKey) throw new Error('Item has no image to tag');
			const { data, width, height } = await fetchAndDecode(item.imageKey);

			// Written before the LLM call, so swatches land even if tagging fails
			await ctx.runMutation(internal.tagging.setPaletteHex, {
				itemId,
				paletteHex: extractPalettePeaks(data, width, height, PALETTE_COLORS)
			});

			return requestImageTags(await toJpegBase64(data, width, height), itemId);
		});
	}
});

// Text mode: summary + topic tags from the page's article text
export const tagTextItem = internalAction({
	args: { itemId: v.id('items') },
	handler: async (ctx, { itemId }): Promise<void> => {
		await runTagging(ctx, itemId, async (item) => {
			// The URL was cleared after this run was queued
			if (item.type !== 'url' || !item.url) throw new Error('Item has no URL to tag');
			// A page with no readable article (a video, a JS app) is tagged from the
			// description its capture read off it instead
			const article = await extractArticleText(item.url).catch((error: unknown) => {
				if (!item.ogDescription) throw error;
				return { title: item.title, text: item.ogDescription };
			});
			return requestArticleTags({ ...article, url: item.url }, itemId);
		});
	}
});

// Only Workers AI's rate limits, server errors and timeouts are left for the
// embedding pool to retry; anything else (a bad request, an image that won't
// load) would fail the same way again
function finalUnlessRetryable(error: unknown): never {
	if (error instanceof RetryableError) throw error;
	throw new NonRetryableError(error instanceof Error ? error.message : String(error), {
		cause: error
	});
}

// Embeds an item's image (or, for notes and text-mode links, its words) into
// itemEmbeddings. Runs on the embedding pool (embeddings.scheduleEmbedding), and
// each attempt starts by re-reading the item, so one turned off or changed since
// an earlier attempt isn't sent. Skips items still waiting on their input and
// inputs already embedded.
export const embedItem = internalAction({
	args: { itemId: v.id('items') },
	handler: async (ctx, { itemId }): Promise<void> => {
		const toMake = async () => {
			const found = await ctx.runQuery(internal.embeddings.getItemForEmbedding, { itemId });
			return found && embeddingToMake(found.item, found.embeddedKey);
		};
		const first = await toMake();
		if (!first) return;
		const { input, key } = first;

		let embedding: number[];
		if (input.kind === 'image') {
			const jpeg = await fetchAndDecode(input.imageKey)
				.then(({ data, width, height }) => toJpegBase64(data, width, height))
				.catch(finalUnlessRetryable);
			// Turned off or changed while its image loaded
			if ((await toMake())?.key !== key) return;
			embedding = await embedImage(jpeg).catch(finalUnlessRetryable);
		} else {
			embedding = await embedText(input.text).catch(finalUnlessRetryable);
		}
		await ctx.runMutation(internal.embeddings.saveEmbedding, { itemId, inputKey: key, embedding });
	}
});
