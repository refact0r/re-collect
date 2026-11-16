import { describe, expect, it } from 'vitest';
import { imageSrcset, variantWidthsFor } from './imageVariants';

describe('variantWidthsFor', () => {
	it('picks the tiers a fifth or more under the original', () => {
		expect(variantWidthsFor(3840)).toEqual([512, 2048]);
		expect(variantWidthsFor(2560)).toEqual([512, 2048]);
		expect(variantWidthsFor(2559)).toEqual([512]);
		expect(variantWidthsFor(1440)).toEqual([512]);
		expect(variantWidthsFor(640)).toEqual([512]);
		expect(variantWidthsFor(639)).toEqual([]);
	});

	it('gives a heavy original a grid copy at its own width, up to the grid tier', () => {
		expect(variantWidthsFor(1600, true)).toEqual([512, 1600]);
		expect(variantWidthsFor(2400, true)).toEqual([512, 2048]);
		expect(variantWidthsFor(3840, true)).toEqual([512, 2048]);
		expect(variantWidthsFor(600, true)).toEqual([600]);
	});
});

describe('imageSrcset', () => {
	const base = 'https://img.test';
	const variants = [
		{ key: 'variants/a-512w.webp', width: 512 },
		{ key: 'variants/a-2048w.webp', width: 2048 }
	];

	it('lists the variants, then the original at its own width', () => {
		expect(
			imageSrcset(base, { imageKey: 'a.png', imageWidth: 3840, imageVariants: variants })
		).toBe(
			'https://img.test/variants/a-512w.webp 460w, https://img.test/variants/a-2048w.webp 1843w, https://img.test/a.png 3840w'
		);
	});

	it('leaves out an original no wider than its widest variant', () => {
		const full = [variants[0], { key: 'variants/a-1600w.webp', width: 1600 }];
		expect(imageSrcset(base, { imageKey: 'a.png', imageWidth: 1600, imageVariants: full })).toBe(
			'https://img.test/variants/a-512w.webp 460w, https://img.test/variants/a-1600w.webp 1440w'
		);
	});

	it('is null with nothing smaller to offer, or no known width', () => {
		expect(imageSrcset(base, { imageKey: 'a.png', imageWidth: 1440 })).toBeNull();
		expect(imageSrcset(base, { imageKey: 'a.png', imageWidth: 300, imageVariants: [] })).toBeNull();
		expect(imageSrcset(base, { imageKey: 'a.png', imageVariants: variants })).toBeNull();
		expect(imageSrcset(base, { imageVariants: variants, imageWidth: 1440 })).toBeNull();
	});
});
