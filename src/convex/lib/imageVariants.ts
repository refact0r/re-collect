// Smaller copies of an item's image, so a small display never downloads
// or decodes the full image. The original stays the widest candidate, capped
// at MAX_ORIGINAL_WIDTH.

export type ImageVariant = { key: string; width: number };

// Two tiers, each with headroom over what shows it on a 2x screen: thumbnails
// and atlas cards (mostly 32-160px), then grid columns (~320-540px). An image
// narrower than a tier is shown as itself there.
export const VARIANT_WIDTHS = [512, 2048];

// Wider originals (huge photos, 5K exports) are replaced by a copy this wide,
// in their own format at high quality, for the item modal
export const MAX_ORIGINAL_WIDTH = 3840;

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

export const variantKey = (itemId: string, width: number, ext: string, now = Date.now()) =>
	`variants/${itemId}-${now}-${width}w.${ext}`;

export const cappedKey = (itemId: string, ext: string, now = Date.now()) =>
	`originals/${itemId}-${now}.${ext}`;

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
