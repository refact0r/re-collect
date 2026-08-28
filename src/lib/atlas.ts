import type { Id } from '../convex/_generated/dataModel';
import type { DisplayItem } from './types';

// Pure analysis over the already-loaded items list for the atlas page.

export interface Swatch {
	hex: string;
	itemId: Id<'items'>;
	label: string;
}

export interface StyleCount {
	name: string;
	count: number;
	// circular-mean hue of the palettes behind this style, null when mostly neutral
	hue: number | null;
}

export interface StylePair {
	a: string;
	b: string;
	count: number;
}

export interface AtlasData {
	itemCount: number;
	swatches: Swatch[];
	styles: StyleCount[];
	pairs: StylePair[];
	tags: { name: string; count: number }[];
	firstDate: number | null;
}

interface Hsl {
	h: number;
	s: number;
	l: number;
}

function hexToHsl(hex: string): Hsl {
	const r = parseInt(hex.slice(1, 3), 16) / 255;
	const g = parseInt(hex.slice(3, 5), 16) / 255;
	const b = parseInt(hex.slice(5, 7), 16) / 255;
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const l = (max + min) / 2;
	let h = 0;
	let s = 0;
	if (max !== min) {
		const d = max - min;
		s = d / (1 - Math.abs(2 * l - 1));
		if (max === r) h = ((g - b) / d + 6) % 6;
		else if (max === g) h = (b - r) / d + 2;
		else h = (r - g) / d + 4;
		h *= 60;
	}
	return { h, s, l };
}

// max-min channel spread, a better colorfulness measure than HSL saturation,
// which overestimates very light colors (creams) and underestimates
// mid-lightness muted ones (dusty rose)
const chroma = ({ s, l }: Hsl) => s * (1 - Math.abs(2 * l - 1));

const isChromatic = (c: Hsl) => chroma(c) > 0.17 && c.l > 0.08 && c.l < 0.9;

function itemLabel(item: DisplayItem): string {
	return item.title || item.url || item.subject || 'untitled';
}

export function buildAtlas(items: DisplayItem[]): AtlasData {
	const swatches: (Swatch & Hsl)[] = [];
	const styleCounts = new Map<string, number>();
	const tagCounts = new Map<string, number>();
	const pairCounts = new Map<string, number>();
	// per-style hue accumulators (circular mean weighted by colorfulness)
	const styleHue = new Map<string, { x: number; y: number; weight: number; total: number }>();

	const sorted = [...items].sort((a, b) => a.dateAdded - b.dateAdded);

	for (const item of sorted) {
		const label = itemLabel(item);
		const parsed = (item.paletteHex ?? []).map((hex) => ({ hex, ...hexToHsl(hex) }));

		for (const color of parsed) {
			swatches.push({ ...color, itemId: item._id, label });
		}

		const styles = [...new Set(item.styles ?? [])];
		for (const style of styles) {
			styleCounts.set(style, (styleCounts.get(style) ?? 0) + 1);
			let acc = styleHue.get(style);
			if (!acc) {
				acc = { x: 0, y: 0, weight: 0, total: 0 };
				styleHue.set(style, acc);
			}
			for (const color of parsed) {
				const colorfulness = isChromatic(color) ? chroma(color) : 0;
				const rad = (color.h * Math.PI) / 180;
				acc.x += Math.cos(rad) * colorfulness;
				acc.y += Math.sin(rad) * colorfulness;
				acc.weight += colorfulness;
				acc.total += 1;
			}
		}
		for (let i = 0; i < styles.length; i++) {
			for (let j = i + 1; j < styles.length; j++) {
				const [a, b] = [styles[i], styles[j]].sort();
				// style names contain spaces, so join on a char that can't appear in them
				const key = `${a}\u0000${b}`;
				pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
			}
		}
		for (const tag of new Set(item.aiTags ?? [])) {
			tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
		}
	}

	// Chromatic swatches sweep the hue wheel; neutrals trail off sorted by lightness
	const chromatic = swatches.filter(isChromatic).sort((a, b) => a.h - b.h || a.l - b.l);
	const neutral = swatches.filter((c) => !isChromatic(c)).sort((a, b) => b.l - a.l);

	const styles: StyleCount[] = [...styleCounts.entries()]
		.map(([name, count]) => {
			const acc = styleHue.get(name);
			// a style is "colorful" when its palettes average meaningfully chromatic
			const hue =
				acc && acc.total > 0 && acc.weight / acc.total > 0.06
					? ((Math.atan2(acc.y, acc.x) * 180) / Math.PI + 360) % 360
					: null;
			return { name, count, hue };
		})
		.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

	const pairs: StylePair[] = [...pairCounts.entries()]
		.map(([key, count]) => {
			const [a, b] = key.split('\u0000');
			return { a, b, count };
		})
		.sort((a, b) => b.count - a.count);

	const tags = [...tagCounts.entries()]
		.map(([name, count]) => ({ name, count }))
		.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

	return {
		itemCount: items.length,
		swatches: [...chromatic, ...neutral].map(({ hex, itemId, label }) => ({ hex, itemId, label })),
		styles,
		pairs,
		tags,
		firstDate: sorted.length > 0 ? sorted[0].dateAdded : null
	};
}
