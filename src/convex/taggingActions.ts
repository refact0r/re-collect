'use node';

import { v } from 'convex/values';
import sharp from 'sharp';
// @ts-expect-error -- no types ship with quantize
import quantize from 'quantize';
import { internalAction } from './_generated/server';
import { internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';

const MAX_EDGE_PX = 768;
const PALETTE_SAMPLE_WIDTH = 200;
const PALETTE_COLORS = 5;

function toHex(rgb: [number, number, number]): string {
	return (
		'#' +
		rgb
			.map((x) => Math.max(0, Math.min(255, x)).toString(16).padStart(2, '0'))
			.join('')
	);
}

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
			const publicBase = process.env.R2_PUBLIC_URL;
			if (!publicBase) throw new Error('R2_PUBLIC_URL not configured');

			const fetchResponse = await fetch(`${publicBase}/${item.imageKey}`);
			if (!fetchResponse.ok) {
				throw new Error(`R2 fetch failed: ${fetchResponse.status}`);
			}
			const buf = Buffer.from(await fetchResponse.arrayBuffer());

			const downscaled = await sharp(buf)
				.rotate()
				.resize({ width: MAX_EDGE_PX, height: MAX_EDGE_PX, fit: 'inside', withoutEnlargement: true })
				.jpeg({ quality: 85 })
				.toBuffer();

			const { data } = await sharp(buf)
				.rotate()
				.resize({ width: PALETTE_SAMPLE_WIDTH })
				.raw()
				.ensureAlpha()
				.toBuffer({ resolveWithObject: true });

			const pixels: [number, number, number][] = [];
			for (let i = 0; i < data.length; i += 4) {
				pixels.push([data[i], data[i + 1], data[i + 2]]);
			}
			const cmap = pixels.length > 0 ? quantize(pixels, PALETTE_COLORS) : null;
			const paletteHex: string[] = cmap
				? (cmap.palette() as [number, number, number][]).map(toHex)
				: [];

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

