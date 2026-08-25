'use node';

import { v } from 'convex/values';
import sharp from 'sharp';
import { extractPalette, validateOptions, MmcqQuantizer } from 'colorthief/internals';
import { internalAction } from './_generated/server';
import { internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';

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

export const repaletteItem = internalAction({
	args: { itemId: v.id('items') },
	handler: async (ctx, args): Promise<void> => {
		const item: Doc<'items'> | null = await ctx.runQuery(internal.tagging.getItemForTagging, {
			itemId: args.itemId
		});
		if (!item || !item.imageKey) return;

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

export const preprocessItem = internalAction({
	args: { itemId: v.id('items') },
	handler: async (ctx, args): Promise<void> => {
		const item: Doc<'items'> | null = await ctx.runQuery(internal.tagging.getItemForTagging, {
			itemId: args.itemId
		});
		if (!item) return;
		if (item.type === 'text' || !item.imageKey) return;

		await ctx.runMutation(internal.tagging.setProcessing, { itemId: args.itemId });

		try {
			const { data, width, height } = await fetchAndDecode(item.imageKey);

			const downscaled = await sharp(data, {
				raw: { width, height, channels: 4 }
			})
				.jpeg({ quality: 85 })
				.toBuffer();

			const paletteHex = extractPalettePeaks(data, width, height, PALETTE_COLORS);

			await ctx.runMutation(internal.tagging.setPaletteHex, {
				itemId: args.itemId,
				paletteHex
			});

			await ctx.scheduler.runAfter(0, internal.tagging.callOpenRouter, {
				itemId: args.itemId,
				downscaledBase64: downscaled.toString('base64'),
				mime: 'image/jpeg'
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			await ctx.runMutation(internal.tagging.setFailed, {
				itemId: args.itemId,
				error: message
			});
		}
	}
});
