// Smaller copies of an item's image, so a small display never downloads
// or decodes the full image, and limits on the image itself.

export type ImageVariant = { key: string; width: number };

// Two tiers, each with headroom over what shows it on a 2x screen: thumbnails
// and atlas cards (mostly 32-160px), then grid columns (~320-540px). An image
// narrower than a tier is shown as itself there.
export const VARIANT_WIDTHS = [512, 2048];

// The most pixels an image may have (one frame) to be saved at all: room for
// a 6900×4600 photo or a 1440×22000 full-page capture. Set by what a variants
// run can process within a Node action's 512 MB, measured on Convex
// (reference/image-variants.md). AVIF decodes whole, at several times the
// memory, so it gets a lower limit.
export const MAX_IMAGE_PIXELS = 32_000_000;
export const MAX_AVIF_PIXELS = 8_000_000;

// The limit for an image of this format (sharp's name: AVIF is 'heif')
export const pixelLimit = (format: string | undefined) =>
	format === 'heif' ? MAX_AVIF_PIXELS : MAX_IMAGE_PIXELS;

// An original wider than this (huge photos, 5K exports) or heavier than
// MAX_ORIGINAL_BYTES is replaced by a WebP, at most this wide,
// for the item modal
export const MAX_ORIGINAL_WIDTH = 3840;
export const MAX_ORIGINAL_BYTES = 10 * 1024 * 1024;

// WebP's limit on either side (and within AVIF's)
export const MAX_SIDE = 16383;

// The width to resize an image to so that it's at most maxWidth wide, at most
// maxPixels in all, and within MAX_SIDE either way (never wider than it is)
export function boundedWidth(width: number, height: number, maxWidth: number, maxPixels: number) {
	const scale = Math.min(
		1,
		maxWidth / width,
		Math.sqrt(maxPixels / (width * height)),
		MAX_SIDE / width,
		MAX_SIDE / height
	);
	return Math.max(1, Math.floor(width * scale));
}

// A copy must save at least this much width over the original to be worth one
const MIN_SHRINK = 1.25;

// Past this, an original is heavy for its size (a PNG photo or export, a
// maximum-quality JPEG): a copy at the same width is a fraction of the bytes.
// Worker screenshots are ~0.07.
export const HEAVY_BYTES_PER_PIXEL = 0.5;

// The copies to make for an image this wide. A heavy one narrower than the
// grid tier also gets a grid copy at its own width, so the grid doesn't load
// a multi-megabyte PNG.
export function variantWidthsFor(width: number, heavy = false) {
	const widths = VARIANT_WIDTHS.filter((target) => target * MIN_SHRINK <= width);
	const top = VARIANT_WIDTHS.at(-1)!;
	if (heavy && !widths.includes(top) && width > (widths.at(-1) ?? 0)) {
		widths.push(Math.min(width, top));
	}
	return widths;
}

export const variantKey = (itemId: string, width: number, now = Date.now()) =>
	`variants/${itemId}-${now}-${width}w.webp`;

export const replacementKey = (itemId: string, now = Date.now()) =>
	`originals/${itemId}-${now}.webp`;

// Each copy is offered as this share of its real width, so the browser only
// picks one it will shrink by at least a tenth: shown at 94-99% of its width
// (a 768 copy in a 726px slot) a copy came out 10-15% softer than the
// original shrunk by the browser, and at 78-92% it matched
const COPY_WIDTH_SHARE = 0.9;

// An <img srcset> over the variants and the original (unless a variant is as
// wide), or null when there's nothing to choose (none made yet, or the image
// is already small)
export function imageSrcset(
	base: string,
	item: { imageKey?: string; imageWidth?: number; imageVariants?: ImageVariant[] }
): string | null {
	const { imageKey, imageWidth, imageVariants } = item;
	if (!imageKey || !imageWidth || !imageVariants?.length) return null;
	const copies = imageVariants.map(({ key, width }) => ({
		key,
		width: Math.floor(width * COPY_WIDTH_SHARE)
	}));
	const candidates =
		imageVariants.at(-1)!.width < imageWidth
			? [...copies, { key: imageKey, width: imageWidth }]
			: copies;
	return candidates.map(({ key, width }) => `${base}/${key} ${width}w`).join(', ');
}
