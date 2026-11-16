import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { makeCopies, processImage } from './imageVariantActions';

const image = (width: number, height: number, format: 'png' | 'jpeg' | 'webp' = 'jpeg') =>
	sharp({ create: { width, height, channels: 3, background: '#3a6' } })
		.toFormat(format)
		.toBuffer();

const widths = (copies: { width: number }[]) => copies.map((c) => c.width);

describe('makeCopies', () => {
	it('makes a WebP copy at each tier well under the original', async () => {
		const { width, height, copies } = await makeCopies(await image(3000, 2000));
		expect({ width, height }).toEqual({ width: 3000, height: 2000 });
		expect(widths(copies)).toEqual([512, 2048]);
		for (const copy of copies) {
			const meta = await sharp(copy.data).metadata();
			expect(meta.format).toBe('webp');
			expect(meta.width).toBe(copy.width);
			expect(meta.height).toBe(Math.round((copy.width * 2000) / 3000));
		}
	});

	it('skips tiers too close to the original, and small images entirely', async () => {
		expect(widths((await makeCopies(await image(2560, 1600))).copies)).toEqual([512, 2048]);
		expect(widths((await makeCopies(await image(1440, 900))).copies)).toEqual([512]);
		expect((await makeCopies(await image(600, 400, 'png'))).copies).toEqual([]);
	});

	it('gives a heavy PNG a light copy at its own width', async () => {
		const noisy = await sharp({
			create: {
				width: 900,
				height: 500,
				channels: 3,
				background: '#000',
				noise: { type: 'gaussian', mean: 128, sigma: 40 }
			}
		})
			.png()
			.toBuffer();
		const { copies } = await makeCopies(noisy);
		expect(widths(copies)).toEqual([512, 900]);
		expect(copies[1].data.length).toBeLessThan(noisy.length / 2);
	});

	it('turns an EXIF-rotated image upright', async () => {
		const sideways = await sharp(await image(2000, 1000))
			.withMetadata({ orientation: 6 })
			.jpeg()
			.toBuffer();
		const { width, height, copies } = await makeCopies(sideways);
		expect({ width, height }).toEqual({ width: 1000, height: 2000 });
		const meta = await sharp(copies[0].data).metadata();
		expect({ width: meta.width, height: meta.height }).toEqual({ width: 512, height: 1024 });
	});

	it('keeps a Display P3 image in P3', async () => {
		const p3 = await sharp(await image(1440, 900))
			.withIccProfile('p3')
			.png()
			.toBuffer();
		const { icc } = await sharp(p3).metadata();
		const meta = await sharp((await makeCopies(p3)).copies[0].data).metadata();
		expect(meta.icc).toEqual(icc);
	});

	it('keeps a tall copy within 10 megapixels', async () => {
		// The 2048 copy would be 2048x9600, so it comes out narrower
		const { copies } = await makeCopies(await image(2560, 12000, 'png'));
		expect(widths(copies)).toEqual([512, 1460]);
		const meta = await sharp(copies[1].data).metadata();
		expect(meta.width! * meta.height!).toBeLessThanOrEqual(10_000_000);
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
		expect(widths(copies)).toEqual([512]);
		const meta = await sharp(copies[0].data).metadata();
		expect({ format: meta.format, pages: meta.pages, width: meta.width }).toEqual({
			format: 'webp',
			pages: 3,
			width: 512
		});
	});

	it('throws on bytes that are no image', async () => {
		await expect(makeCopies(Buffer.from('nope'))).rejects.toThrow();
	});
});

describe('processImage', () => {
	it('replaces an original wider than 3840 with a WebP 3840 wide, and copies that', async () => {
		const { width, height, replacement, copies } = await processImage(
			await image(6000, 4000, 'png')
		);
		expect(replacement).toMatchObject({ width: 3840, height: 2560 });
		const meta = await sharp(replacement!.data).metadata();
		expect({ format: meta.format, width: meta.width }).toEqual({ format: 'webp', width: 3840 });
		expect({ width, height }).toEqual({ width: 3840, height: 2560 });
		expect(widths(copies)).toEqual([512, 2048]);
	});

	it('replaces an original over 10 MB at its own size', { timeout: 30_000 }, async () => {
		const noisy = await sharp({
			create: {
				width: 2400,
				height: 1800,
				channels: 3,
				background: '#000',
				noise: { type: 'gaussian', mean: 128, sigma: 60 }
			}
		})
			.png({ compressionLevel: 1 })
			.toBuffer();
		expect(noisy.length).toBeGreaterThan(10 * 1024 * 1024);
		const { replacement } = await processImage(noisy);
		expect(replacement).toMatchObject({ width: 2400, height: 1800 });
		expect(replacement!.data.length).toBeLessThan(noisy.length / 2);
	});

	it('leaves an original within the limits alone', async () => {
		const { replacement, width } = await processImage(await image(3840, 2160));
		expect(replacement).toBeNull();
		expect(width).toBe(3840);
	});

	it('refuses an image over 32 megapixels before decoding it', async () => {
		await expect(processImage(await image(8000, 6000))).rejects.toThrow(/pixel limit/i);
	});

	it('keeps a tall replacement within 10 megapixels', async () => {
		const { replacement } = await processImage(await image(4000, 8000, 'png'));
		expect(replacement!.width * replacement!.height).toBeLessThanOrEqual(10_000_000);
	});
});
