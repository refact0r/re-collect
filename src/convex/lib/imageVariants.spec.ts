import { describe, expect, it } from 'vitest';
import { imageSrcset, variantWidthsFor } from './imageVariants';

describe('variantWidthsFor', () => {
	it('picks the widths a fifth or more under the original', () => {
		expect(variantWidthsFor(5865)).toEqual([256, 768, 1536]);
		expect(variantWidthsFor(2880)).toEqual([256, 768, 1536]);
		expect(variantWidthsFor(1920)).toEqual([256, 768, 1536]);
		expect(variantWidthsFor(1440)).toEqual([256, 768]);
		expect(variantWidthsFor(960)).toEqual([256, 768]);
		expect(variantWidthsFor(959)).toEqual([256]);
		expect(variantWidthsFor(319)).toEqual([]);
	});
});

describe('imageSrcset', () => {
	const base = 'https://img.test';
	const variants = [
		{ key: 'variants/a-256w.webp', width: 256 },
		{ key: 'variants/a-768w.webp', width: 768 }
	];

	it('lists the variants, then the original at its own width', () => {
		expect(
			imageSrcset(base, { imageKey: 'a.png', imageWidth: 1440, imageVariants: variants })
		).toBe(
			'https://img.test/variants/a-256w.webp 256w, https://img.test/variants/a-768w.webp 768w, https://img.test/a.png 1440w'
		);
	});

	it('is null with nothing smaller to offer, or no known width', () => {
		expect(imageSrcset(base, { imageKey: 'a.png', imageWidth: 1440 })).toBeNull();
		expect(imageSrcset(base, { imageKey: 'a.png', imageWidth: 300, imageVariants: [] })).toBeNull();
		expect(imageSrcset(base, { imageKey: 'a.png', imageVariants: variants })).toBeNull();
		expect(imageSrcset(base, { imageVariants: variants, imageWidth: 1440 })).toBeNull();
	});
});
