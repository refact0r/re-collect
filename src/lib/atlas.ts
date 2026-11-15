import type { Id } from '../convex/_generated/dataModel';
import { fontDisplayName, fontQuery } from '../convex/lib/fonts';
import type { DisplayItem } from './types';

// Pure analysis over the loaded items and their places on the library map,
// shared by the atlas map and the patterns page.

type ItemId = Id<'items'>;

export interface MapPoint {
	itemId: ItemId;
	x: number;
	y: number;
}

export interface Position {
	x: number;
	y: number;
}

export const itemLabel = (item: DisplayItem): string =>
	item.title || item.subject || item.url || item.content?.slice(0, 80) || 'untitled';

const countBy = <T>(values: Iterable<T>) => {
	const counts = new Map<T, number>();
	for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
	return counts;
};

const ranked = <T>(counts: Map<T, number>) =>
	[...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);

/* Color */

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

export interface Swatch {
	hex: string;
	itemId: ItemId;
}

// Every palette color of the given items as two strips: the colorful ones
// round the hue wheel, and the rest from light to dark
export function colorStrips(items: DisplayItem[]): { hue: Swatch[]; tone: Swatch[] } {
	const swatches = items.flatMap((item) =>
		(item.paletteHex ?? []).map((hex) => ({ hex, itemId: item._id, ...hexToHsl(hex) }))
	);
	const strip = (colors: typeof swatches) => colors.map(({ hex, itemId }) => ({ hex, itemId }));
	return {
		hue: strip(swatches.filter(isChromatic).sort((a, b) => a.h - b.h || a.l - b.l)),
		tone: strip(swatches.filter((c) => !isChromatic(c)).sort((a, b) => b.l - a.l))
	};
}

// The color an item is placed by on the wheel: its first colorful palette
// entry (palettes run most dominant first), or its first entry when it has none
export function itemColor(item: DisplayItem): (Hsl & { hex: string; chromatic: boolean }) | null {
	const colors = (item.paletteHex ?? []).map((hex) => ({ hex, ...hexToHsl(hex) }));
	if (colors.length === 0) return null;
	const colorful = colors.find(isChromatic);
	return { ...(colorful ?? colors[0]), chromatic: !!colorful };
}

const GOLDEN_ANGLE = 2.399963;

// The items as a color wheel: hue is the angle and colorfulness the distance
// out, with the neutral items spiralling from the middle, lightest first
export function colorWheel(items: DisplayItem[]): Map<ItemId, Position> {
	const colored = items.flatMap((item) => {
		const color = itemColor(item);
		return color ? [{ id: item._id, color }] : [];
	});
	const neutral = colored.filter((c) => !c.color.chromatic).sort((a, b) => b.color.l - a.color.l);
	const hub = Math.sqrt(neutral.length) + 1;

	const placed = new Map<ItemId, Position>();
	neutral.forEach(({ id }, i) => {
		const radius = Math.sqrt(i + 0.5);
		placed.set(id, {
			x: Math.cos(i * GOLDEN_ANGLE) * radius,
			y: Math.sin(i * GOLDEN_ANGLE) * radius
		});
	});
	for (const { id, color } of colored) {
		if (!color.chromatic) continue;
		// red at the top, running clockwise
		const angle = ((color.h - 90) * Math.PI) / 180;
		const radius = hub + 1 + chroma(color) * hub * 1.5;
		placed.set(id, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
	}
	return placed;
}

/* Styles */

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

export const countStyles = (items: DisplayItem[]) =>
	ranked(countBy(items.flatMap((item) => [...new Set(item.styles ?? [])]))).sort(
		(a, b) => b.count - a.count || a.name.localeCompare(b.name)
	);

// Styles with the color they tend to come in, and how often each two share an item
export function styleGraph(items: DisplayItem[]): { styles: StyleCount[]; pairs: StylePair[] } {
	const pairCounts = new Map<string, number>();
	// per-style hue accumulators (circular mean weighted by colorfulness)
	const styleHue = new Map<string, { x: number; y: number; weight: number; total: number }>();

	for (const item of items) {
		const colors = (item.paletteHex ?? []).map(hexToHsl);
		const styles = [...new Set(item.styles ?? [])].sort();
		for (const style of styles) {
			let acc = styleHue.get(style);
			if (!acc) styleHue.set(style, (acc = { x: 0, y: 0, weight: 0, total: 0 }));
			for (const color of colors) {
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
				// style names contain spaces, so join on a char that can't appear in them
				const key = `${styles[i]}\u0000${styles[j]}`;
				pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
			}
		}
	}

	const styles = countStyles(items).map(({ name, count }) => {
		const acc = styleHue.get(name);
		// a style is "colorful" when its palettes average meaningfully chromatic
		const hue =
			acc && acc.total > 0 && acc.weight / acc.total > 0.06
				? ((Math.atan2(acc.y, acc.x) * 180) / Math.PI + 360) % 360
				: null;
		return { name, count, hue };
	});
	const pairs = ranked(pairCounts).map(({ name, count }) => {
		const [a, b] = name.split('\u0000');
		return { a, b, count };
	});
	return { styles, pairs };
}

/* Regions: groups of items that sit together on the map */

export interface Region {
	id: number;
	name: string;
	// The styles that set it apart from the rest of the library, strongest
	// first, and the ones among them its name is made of
	styles: string[];
	named: string[];
	itemIds: ItemId[];
	x: number;
	y: number;
}

const MIN_REGION_POINTS = 8;
const MAX_REGIONS = 12;
const distance2 = (a: Position, b: Position) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

const centre = (points: Position[]): Position => ({
	x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
	y: points.reduce((sum, p) => sum + p.y, 0) / points.length
});

const nearestIndex = (p: Position, centres: Position[]) =>
	centres.reduce((best, c, i) => (distance2(p, c) < distance2(p, centres[best]) ? i : best), 0);

// k-means over the map's points. Seeded by farthest-first traversal from the
// middle, so the same map always splits the same way.
function cluster(points: MapPoint[], k: number): MapPoint[][] {
	const middle = centre(points);
	let centres: Position[] = [points[nearestIndex(middle, points)]];
	while (centres.length < k) {
		const spread = (p: MapPoint) => distance2(p, centres[nearestIndex(p, centres)]);
		centres.push(points.reduce((far, p) => (spread(p) > spread(far) ? p : far)));
	}
	let groups: MapPoint[][] = [];
	for (let round = 0; round < 30; round++) {
		groups = centres.map(() => []);
		for (const p of points) groups[nearestIndex(p, centres)].push(p);
		centres = groups.map((group, i) => (group.length ? centre(group) : centres[i]));
	}
	return groups.filter((group) => group.length > 0);
}

// What sets a group apart: the styles its items carry more often than the
// library does, needing at least two items to count
function distinctiveStyles(group: DisplayItem[], all: Map<string, number>, total: number) {
	return [...countBy(group.flatMap((item) => [...new Set(item.styles ?? [])]))]
		.map(([name, count]) => ({
			name,
			count,
			lift: count / group.length - (all.get(name) ?? 0) / total
		}))
		.filter(({ count, lift }) => count >= 2 && lift > 0)
		.sort((a, b) => b.lift - a.lift || a.name.localeCompare(b.name))
		.map(({ name }) => name);
}

// Splits the map into regions, biggest first, each named by its two most
// distinctive styles. A style heads only one region's name where there's a
// choice, so neighbours don't all read "minimalist".
export function findRegions(points: MapPoint[], items: DisplayItem[]): Region[] {
	const byId = new Map(items.map((item) => [item._id, item]));
	const mapped = points.filter((p) => byId.has(p.itemId));
	if (mapped.length < MIN_REGION_POINTS) return [];

	const k = Math.min(MAX_REGIONS, Math.max(2, Math.round(Math.sqrt(mapped.length / 2))));
	const groups = cluster(mapped, k).sort((a, b) => b.length - a.length);
	const all = countBy(mapped.flatMap((p) => [...new Set(byId.get(p.itemId)!.styles ?? [])]));

	const taken = new Set<string>();
	return groups.map((group, id) => {
		const styles = distinctiveStyles(
			group.map((p) => byId.get(p.itemId)!),
			all,
			mapped.length
		);
		const fresh = styles.filter((style) => !taken.has(style));
		const named = (fresh.length ? [...fresh, ...styles.filter((s) => taken.has(s))] : styles).slice(
			0,
			2
		);
		if (named[0]) taken.add(named[0]);
		return {
			id,
			name: named.join(' · ') || `region ${id + 1}`,
			styles,
			named,
			itemIds: group.map((p) => p.itemId),
			...centre(group)
		};
	});
}

/* Lenses: each one narrows what the map lights up */

export const UNCOLLECTED = 'uncollected';

// A brushed stretch of a color strip (indexes into it, both ends included)
// and the items its swatches come from
export interface Brush {
	range: [number, number];
	itemIds: Set<ItemId>;
}

export interface Lenses {
	// Collection ids, plus UNCOLLECTED for items in none
	collections: Set<string>;
	styles: Set<string>;
	// Brushed stretches of the two color strips
	hue: Brush | null;
	tone: Brush | null;
	// dateAdded range, both ends included
	added: [number, number] | null;
	// What a search on the map found
	found: { query: string; itemIds: Set<ItemId> } | null;
}

export const noLenses = (): Lenses => ({
	collections: new Set(),
	styles: new Set(),
	hue: null,
	tone: null,
	added: null,
	found: null
});

// The items every active lens agrees on, or null when no lens is active (so
// everything is lit). Within a lens any of its picks is enough.
export function litItems(items: DisplayItem[], lenses: Lenses): Set<ItemId> | null {
	const tests: ((item: DisplayItem) => boolean)[] = [];
	const { collections, styles, hue, tone, added, found } = lenses;
	if (collections.size > 0) {
		tests.push((item) =>
			item.collections.length > 0
				? item.collections.some((id) => collections.has(id))
				: collections.has(UNCOLLECTED)
		);
	}
	if (styles.size > 0) tests.push((item) => (item.styles ?? []).some((s) => styles.has(s)));
	if (hue) tests.push((item) => hue.itemIds.has(item._id));
	if (tone) tests.push((item) => tone.itemIds.has(item._id));
	if (added) tests.push((item) => item.dateAdded >= added[0] && item.dateAdded <= added[1]);
	if (found) tests.push((item) => found.itemIds.has(item._id));
	if (tests.length === 0) return null;
	return new Set(items.filter((item) => tests.every((test) => test(item))).map((item) => item._id));
}

// Items added per calendar month, from the first item's month to the last's
export interface Month {
	start: number;
	end: number;
	label: string;
	count: number;
}

export function monthsOf(items: DisplayItem[]): Month[] {
	if (items.length === 0) return [];
	const dates = items.map((item) => item.dateAdded);
	const last = Math.max(...dates);
	const months: Month[] = [];
	const cursor = new Date(Math.min(...dates));
	cursor.setDate(1);
	cursor.setHours(0, 0, 0, 0);
	while (cursor.getTime() <= last) {
		const start = cursor.getTime();
		const label = cursor
			.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
			.toLowerCase();
		cursor.setMonth(cursor.getMonth() + 1);
		const end = cursor.getTime() - 1;
		months.push({ start, end, label, count: dates.filter((d) => d >= start && d <= end).length });
	}
	return months;
}

/* Patterns: what the map says about the library */

export interface Shift {
	region: Region;
	// How many of the recent items landed in the region, and its share of them
	recent: number;
	share: number;
	// Its share of everything before them
	before: number;
}

const MIN_RECENT = 8;

// Where the newest quarter of the mapped items landed, against where the rest
// did: the regions growing fastest first. Null for a library too small to say.
export function recentShift(
	regions: Region[],
	items: DisplayItem[]
): { since: number; count: number; shifts: Shift[] } | null {
	const added = new Map(items.map((item) => [item._id, item.dateAdded]));
	const newestFirst = regions
		.flatMap((r) => r.itemIds)
		.sort((a, b) => (added.get(b) ?? 0) - (added.get(a) ?? 0));
	const count = Math.max(MIN_RECENT, Math.round(newestFirst.length / 4));
	if (newestFirst.length < count * 2) return null;

	const recentIds = new Set(newestFirst.slice(0, count));
	const older = newestFirst.length - count;
	const shifts = regions.map((region) => {
		const recent = region.itemIds.filter((id) => recentIds.has(id)).length;
		return {
			region,
			recent,
			share: recent / count,
			before: (region.itemIds.length - recent) / older
		};
	});
	return {
		since: added.get(newestFirst[count - 1]) ?? 0,
		count,
		shifts: shifts.sort((a, b) => b.share - b.before - (a.share - a.before))
	};
}

export interface FontUse {
	name: string;
	// The search that finds its items
	query: string;
	itemIds: ItemId[];
}

// An item's fonts, one entry per typeface however many cuts the page loads
const fontsOf = (item: DisplayItem) => [
	...new Map((item.fonts ?? []).map((font) => [fontQuery(font), font])).values()
];

// Every typeface saved sites are set in, most used first (ties by name)
export function fontsByUse(items: DisplayItem[]): FontUse[] {
	const fonts = new Map<string, FontUse>();
	for (const item of items) {
		for (const font of fontsOf(item)) {
			const query = fontQuery(font);
			let use = fonts.get(query);
			if (!use) fonts.set(query, (use = { name: fontDisplayName(font), query, itemIds: [] }));
			use.itemIds.push(item._id);
		}
	}
	return [...fonts.values()].sort(
		(a, b) => b.itemIds.length - a.itemIds.length || a.name.localeCompare(b.name)
	);
}

// The typefaces that turn up together on more than one site, most often first
export function fontPairings(items: DisplayItem[], limit = 8) {
	const pairs = items.flatMap((item) => {
		const names = fontsOf(item).map(fontDisplayName).sort();
		return names.flatMap((a, i) => names.slice(i + 1).map((b) => `${a}\u0000${b}`));
	});
	return ranked(countBy(pairs))
		.filter((pair) => pair.count > 1)
		.slice(0, limit)
		.map(({ name, count }) => {
			const [a, b] = name.split('\u0000');
			return { a, b, count };
		});
}

export function hostOf(url: string | undefined): string | null {
	try {
		return url ? new URL(url).hostname.replace(/^www\./, '') : null;
	} catch {
		return null;
	}
}
