import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { makeCopies } from './imageVariantActions';

const image = (width: number, height: number, format: 'png' | 'jpeg' = 'jpeg') =>
	sharp({ create: { width, height, channels: 3, background: '#3a6' } })
		.toFormat(format)
		.toBuffer();

describe('makeCopies', () => {
	it('makes a WebP copy at each width well under the original', async () => {
		const { width, height, copies } = await makeCopies(await image(3000, 2000));
		expect({ width, height }).toEqual({ width: 3000, height: 2000 });
		expect(copies.map((c) => c.width)).toEqual([256, 768, 1536]);
		for (const copy of copies) {
			const meta = await sharp(copy.data).metadata();
			expect(meta.format).toBe('webp');
			expect(meta.width).toBe(copy.width);
			expect(meta.height).toBe(Math.round((copy.width * 2000) / 3000));
		}
	});

	it('skips widths too close to the original, and small images entirely', async () => {
		expect((await makeCopies(await image(1440, 900))).copies.map((c) => c.width)).toEqual([
			256, 768
		]);
		expect((await makeCopies(await image(900, 600))).copies.map((c) => c.width)).toEqual([256]);
		expect((await makeCopies(await image(300, 200, 'png'))).copies).toEqual([]);
	});

	it('turns an EXIF-rotated image upright', async () => {
		const sideways = await sharp(await image(2000, 1000))
			.withMetadata({ orientation: 6 })
			.jpeg()
			.toBuffer();
		const { width, height, copies } = await makeCopies(sideways);
		expect({ width, height }).toEqual({ width: 1000, height: 2000 });
		const meta = await sharp(copies[0].data).metadata();
		expect({ width: meta.width, height: meta.height }).toEqual({ width: 256, height: 512 });
	});

	it('keeps a very tall image within WebP limits', async () => {
		// 1000 wide: the 768 copy would be 23040 tall, so it comes out narrower
		const { copies } = await makeCopies(await image(1000, 30000, 'png'));
		expect(copies.map((c) => c.width)).toEqual([256, 546]);
		const meta = await sharp(copies[1].data).metadata();
		expect({ width: meta.width, height: meta.height }).toEqual({ width: 546, height: 16383 });
	});

	it('keeps an animation animated', async () => {
		const frames = await Promise.all(
			['#f00', '#0f0', '#00f'].map((background) =>
				sharp({ create: { width: 1200, height: 800, channels: 4, background } })
					.png()
					.toBuffer()
			)
		);
		const gif = await sharp(frames, { join: { animated: true } })
			.gif()
			.toBuffer();
		const { copies } = await makeCopies(gif);
		expect(copies.map((c) => c.width)).toEqual([256, 768]);
		const meta = await sharp(copies[0].data).metadata();
		expect({ format: meta.format, pages: meta.pages, width: meta.width }).toEqual({
			format: 'webp',
			pages: 3,
			width: 256
		});
	});

	it('throws on bytes that are no image', async () => {
		await expect(makeCopies(Buffer.from('nope'))).rejects.toThrow();
	});
});
