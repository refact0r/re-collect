// Smaller WebP copies of an item's image, so a small display (atlas cards,
// pattern thumbnails, grid columns) never downloads or decodes the original.
// The original is kept as is and stays the widest candidate.

export type ImageVariant = { key: string; width: number };

// Sized for the surfaces that show them, at 1x and 2x: thumbnails and atlas
// cards at their usual sizes (32-104px), larger atlas cards and grid columns
// (~150-400px), the item modal and wide grid columns
export const VARIANT_WIDTHS = [256, 768, 1536];

// A copy must save at least this much width over the original to be worth one
const MIN_SHRINK = 1.25;

export function variantWidthsFor(width: number) {
	return VARIANT_WIDTHS.filter((target) => target * MIN_SHRINK <= width);
}

export const variantKey = (itemId: string, width: number, now = Date.now()) =>
	`variants/${itemId}-${now}-${width}w.webp`;

// An <img srcset> over the variants and the original, or null when there's
// nothing smaller to choose (none made yet, or the image is already small)
export function imageSrcset(
	base: string,
	item: { imageKey?: string; imageWidth?: number; imageVariants?: ImageVariant[] }
): string | null {
	if (!item.imageKey || !item.imageWidth || !item.imageVariants?.length) return null;
	return [...item.imageVariants, { key: item.imageKey, width: item.imageWidth }]
		.map(({ key, width }) => `${base}/${key} ${width}w`)
		.join(', ');
}
