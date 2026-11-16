import { describe, it, expect } from 'vitest';
import type { Id } from '../convex/_generated/dataModel';
import {
	cellsOf,
	colorStrips,
	colorWheel,
	countStyles,
	findRegions,
	fontPairings,
	hostOf,
	litItems,
	MAX_CELLS,
	monthsOf,
	noLenses,
	recentShift,
	fontsByUse,
	styleGraph,
	UNCOLLECTED,
	type MapPoint,
	type Region
} from './atlas';
import type { DisplayItem } from './types';

type ItemId = Id<'items'>;
type CollectionId = Id<'collections'>;

const id = (name: string) => name as ItemId;
const collection = (name: string) => name as CollectionId;

function item(name: string, fields: Partial<DisplayItem> = {}): DisplayItem {
	return {
		_id: id(name),
		_creationTime: 0,
		type: 'image',
		collections: [],
		dateAdded: 0,
		dateModified: 0,
		...fields
	};
}

// A small deterministic jitter, so clustered points never coincide
const jitter = (i: number) => ((i * 7919) % 100) / 400;

// `count` points around (x, y), named prefix0, prefix1, ...
const blob = (prefix: string, count: number, x: number, y: number): MapPoint[] =>
	Array.from({ length: count }, (_, i) => ({
		itemId: id(`${prefix}${i}`),
		x: x + jitter(i),
		y: y + jitter(i + 31)
	}));

const itemsFor = (points: MapPoint[], fields: (i: number) => Partial<DisplayItem>) =>
	points.map((p, i) => item(p.itemId, fields(i)));

describe('findRegions', () => {
	const a = blob('a', 8, 0, 0);
	const b = blob('b', 6, 10, 0);
	const c = blob('c', 4, 0, 10);
	const points = [...a, ...b, ...c];
	const items = [
		...itemsFor(a, () => ({ styles: ['brutalist', 'monochrome', 'minimalist'] })),
		...itemsFor(b, () => ({ styles: ['pastel', 'playful', 'minimalist'] })),
		...itemsFor(c, () => ({ styles: ['editorial', 'serif', 'minimalist'] }))
	];

	it('splits the map into its groups, biggest first, named by what sets them apart', () => {
		const regions = findRegions(points, items);
		expect(regions.map((r) => r.name)).toEqual([
			'brutalist · monochrome',
			'pastel · playful',
			'editorial · serif'
		]);
		expect(regions.map((r) => r.id)).toEqual([0, 1, 2]);
		expect(new Set(regions[0].itemIds)).toEqual(new Set(a.map((p) => p.itemId)));
		expect(new Set(regions[2].itemIds)).toEqual(new Set(c.map((p) => p.itemId)));
		expect(regions[0].named).toEqual(['brutalist', 'monochrome']);
		// a style every item carries sets nothing apart
		expect(regions[0].styles).not.toContain('minimalist');
	});

	it('is deterministic', () => {
		expect(findRegions(points, items)).toEqual(findRegions(points, items));
		const shuffled = [...points].reverse();
		expect(findRegions(shuffled, items).map((r) => r.name)).toEqual(
			findRegions(points, items).map((r) => r.name)
		);
	});

	it('gives each region its own leading style where there is a choice', () => {
		// "warm" leads both a and b, so b leads with serif, which c then skips
		const shared = [
			...itemsFor(a, (i) => ({ styles: i < 4 ? ['warm', 'grid'] : ['warm'] })),
			...itemsFor(b, (i) => ({ styles: i < 3 ? ['warm', 'serif'] : ['warm'] })),
			...itemsFor(c, () => ({ styles: ['cool', 'grid', 'serif'] }))
		];
		const names = findRegions(points, shared).map((r) => r.name);
		expect(names).toEqual(['warm · grid', 'serif · warm', 'cool · grid']);
	});

	it('numbers a region with no distinctive styles', () => {
		const plain = itemsFor(points, () => ({}));
		expect(findRegions(points, plain).map((r) => r.name)).toEqual([
			'region 1',
			'region 2',
			'region 3'
		]);
	});

	it('needs enough mapped items', () => {
		expect(findRegions(points.slice(0, 7), items)).toEqual([]);
		// points without a loaded item don't count
		expect(findRegions(points, items.slice(0, 7))).toEqual([]);
	});

	it('makes no more regions than there are places, however many it aims for', () => {
		const at = (prefix: string, count: number, x: number, y: number) =>
			Array.from({ length: count }, (_, i) => ({ itemId: id(`${prefix}${i}`), x, y }));
		const same = at('s', 20, 1, 2);
		const one = findRegions(
			same,
			itemsFor(same, () => ({}))
		);
		expect(one).toHaveLength(1);
		expect(one[0]).toMatchObject({ x: 1, y: 2 });
		expect(one[0].itemIds).toHaveLength(20);

		// two places, though 20 points aim for three regions
		const two = [...at('p', 10, 0, 0), ...at('q', 10, 5, 5)];
		const regions = findRegions(
			two,
			itemsFor(two, () => ({}))
		);
		expect(regions.map((r) => [r.itemIds.length, r.x, r.y])).toEqual([
			[10, 0, 0],
			[10, 5, 5]
		]);
	});
});

describe('litItems', () => {
	const items = [
		item('a', { collections: [collection('c1')], styles: ['bold'], dateAdded: 10 }),
		item('b', { collections: [collection('c2')], styles: ['soft'], dateAdded: 20 }),
		item('c', { styles: ['bold'], dateAdded: 30 })
	];
	const lit = (lenses: Partial<ReturnType<typeof noLenses>>) =>
		litItems(items, { ...noLenses(), ...lenses });

	it('lights everything (null) with no lens', () => {
		expect(lit({})).toBeNull();
	});

	it('takes any pick within a lens', () => {
		expect(lit({ collections: new Set(['c1', UNCOLLECTED]) })).toEqual(new Set(['a', 'c']));
		expect(lit({ styles: new Set(['bold', 'soft']) })).toEqual(new Set(['a', 'b', 'c']));
	});

	it('needs every lens to agree', () => {
		expect(lit({ styles: new Set(['bold']), added: [15, 40] })).toEqual(new Set(['c']));
		expect(
			lit({
				styles: new Set(['bold']),
				found: { query: 'x', itemIds: new Set([id('a'), id('b')]) }
			})
		).toEqual(new Set(['a']));
	});

	it('lights the items behind a brushed stretch of either color strip', () => {
		const brush = (...names: string[]) => ({
			range: [0, 1] as [number, number],
			itemIds: new Set(names.map(id))
		});
		expect(lit({ hue: brush('b') })).toEqual(new Set(['b']));
		expect(lit({ tone: brush('a', 'b', 'c'), styles: new Set(['bold']) })).toEqual(
			new Set(['a', 'c'])
		);
		expect(lit({ hue: brush('a', 'b'), tone: brush('b', 'c') })).toEqual(new Set(['b']));
		expect(lit({ hue: brush('b'), added: [0, 15] })).toEqual(new Set());
	});
});
describe('recentShift', () => {
	const old = Array.from({ length: 12 }, (_, i) => item(`o${i}`, { dateAdded: i + 1 }));
	const fresh = Array.from({ length: 8 }, (_, i) => item(`r${i}`, { dateAdded: 100 + i }));
	const region = (regionId: number, members: DisplayItem[]): Region => ({
		id: regionId,
		name: `region ${regionId + 1}`,
		styles: [],
		named: [],
		itemIds: members.map((m) => m._id),
		x: 0,
		y: 0
	});

	it('compares where the newest items landed with the rest, growing first', () => {
		const regions = [region(0, old), region(1, fresh)];
		const shift = recentShift(regions, [...old, ...fresh])!;
		expect(shift.count).toBe(8);
		expect(shift.since).toBe(100);
		expect(shift.recentIds).toEqual(new Set(fresh.map((f) => f._id)));
		expect(shift.shifts.map((s) => [s.region.id, s.recent, s.share, s.before])).toEqual([
			[1, 8, 1, 0],
			[0, 0, 0, 1]
		]);
	});

	it('mixes the recent items across regions', () => {
		const regions = [region(0, [...old.slice(0, 6), ...fresh.slice(0, 2)])];
		regions.push(region(1, [...old.slice(6), ...fresh.slice(2)]));
		const shift = recentShift(regions, [...old, ...fresh])!;
		expect(shift.shifts[0]).toMatchObject({ recent: 6, share: 0.75, before: 0.5 });
		expect(shift.shifts[1]).toMatchObject({ recent: 2, share: 0.25, before: 0.5 });
	});

	it('counts exactly its recent items when others share the boundary date', () => {
		const tied = [...old.slice(0, 11), item('o11', { dateAdded: 100 })];
		const shift = recentShift([region(0, tied), region(1, fresh)], [...tied, ...fresh])!;
		expect(shift.since).toBe(100);
		expect(shift.recentIds.size).toBe(8);
		expect(shift.shifts.reduce((sum, s) => sum + s.recent, 0)).toBe(8);
	});

	it('says nothing about a small library', () => {
		expect(recentShift([region(0, old.slice(0, 8)), region(1, fresh.slice(0, 7))], old)).toBeNull();
	});
});

describe('monthsOf', () => {
	it('counts every month from the first item to the last, empty ones included', () => {
		const items = [
			item('a', { dateAdded: new Date(2026, 0, 15).getTime() }),
			item('b', { dateAdded: new Date(2026, 0, 31, 23).getTime() }),
			item('c', { dateAdded: new Date(2026, 2, 3).getTime() })
		];
		const months = monthsOf(items);
		expect(months.map((m) => [m.label, m.count])).toEqual([
			['jan 2026', 2],
			['feb 2026', 0],
			['mar 2026', 1]
		]);
		expect(months[0].start).toBe(new Date(2026, 0, 1).getTime());
		expect(months[0].end).toBe(new Date(2026, 1, 1).getTime() - 1);
	});

	it('is empty for no items', () => {
		expect(monthsOf([])).toEqual([]);
	});
});

describe('colorStrips', () => {
	it('sorts the colorful swatches by hue, the rest light to dark', () => {
		const items = [
			item('a', { paletteHex: ['#0000ff', '#000000', '#ff0000', '#ffffff'] }),
			item('b', { paletteHex: ['#808080', '#00ff00'] }),
			item('c')
		];
		expect(colorStrips(items)).toEqual({
			hue: [
				{ hex: '#ff0000', itemId: 'a' },
				{ hex: '#00ff00', itemId: 'b' },
				{ hex: '#0000ff', itemId: 'a' }
			],
			tone: [
				{ hex: '#ffffff', itemId: 'a' },
				{ hex: '#808080', itemId: 'b' },
				{ hex: '#000000', itemId: 'a' }
			]
		});
	});

	it('puts every palette color in exactly one strip', () => {
		const palettes = [
			['#f5f0e6', '#ff8800', '#1a1a1a'],
			['#c08080', '#3366cc', '#eeeeee', '#3366cc']
		];
		const { hue, tone } = colorStrips(
			palettes.map((paletteHex, i) => item(`i${i}`, { paletteHex }))
		);
		expect([...hue, ...tone].map((s) => s.hex).sort()).toEqual(palettes.flat().sort());
		// washed-out colors count as tones
		expect(tone.map((s) => s.hex)).toContain('#f5f0e6');
		expect(hue.map((s) => s.hex)).toContain('#ff8800');
	});
});

describe('cellsOf', () => {
	const swatches = (count: number) =>
		Array.from({ length: count }, (_, i) => ({ hex: `#${i}`, itemId: id(`i${i}`) }));

	it('gives each swatch its own cell under the cap', () => {
		expect(cellsOf(swatches(3))).toEqual([
			{ hex: '#0', from: 0, to: 0 },
			{ hex: '#1', from: 1, to: 1 },
			{ hex: '#2', from: 2, to: 2 }
		]);
		expect(cellsOf(swatches(MAX_CELLS))).toHaveLength(MAX_CELLS);
		expect(cellsOf([])).toEqual([]);
	});

	it('shares cells past the cap, covering every swatch once', () => {
		const strip = swatches(1000);
		const cells = cellsOf(strip);
		expect(cells).toHaveLength(MAX_CELLS);
		expect(cells[0].from).toBe(0);
		// both ends are included
		expect(cells.at(-1)!.to).toBe(strip.length - 1);
		cells.slice(1).forEach((cell, i) => expect(cell.from).toBe(cells[i].to + 1));
		for (const cell of cells) {
			expect(cell.to).toBeGreaterThanOrEqual(cell.from);
			expect(cell.hex).toBe(strip[Math.floor((cell.from + cell.to) / 2)].hex);
		}
	});
});

describe('colorWheel', () => {
	const items = [
		item('red', { paletteHex: ['#ff0000'] }),
		item('blue', { paletteHex: ['#ffffff', '#0000ff'] }),
		item('white', { paletteHex: ['#ffffff'] }),
		item('gray', { paletteHex: ['#808080', '#777777'] }),
		item('none')
	];
	const wheel = colorWheel(items);
	const radius = (name: string) => Math.hypot(wheel.get(id(name))!.x, wheel.get(id(name))!.y);

	it('places every item with a palette', () => {
		expect([...wheel.keys()].sort()).toEqual(['blue', 'gray', 'red', 'white']);
	});

	it('puts red at the top and runs the hues clockwise', () => {
		const red = wheel.get(id('red'))!;
		expect(red.x).toBeCloseTo(0, 6);
		expect(red.y).toBeLessThan(0);
		// blue (240°) is 150° clockwise from red: lower left
		const blue = wheel.get(id('blue'))!;
		expect(blue.x).toBeLessThan(0);
		expect(blue.y).toBeGreaterThan(0);
	});

	it('gives each item the color it was placed by', () => {
		expect(wheel.get(id('blue'))!.hex).toBe('#0000ff');
		expect(wheel.get(id('gray'))!.hex).toBe('#808080');
	});

	it('spirals the neutrals in the middle, lightest first', () => {
		expect(wheel.get(id('white'))).toEqual({ x: Math.sqrt(0.5), y: 0, hex: '#ffffff' });
		expect(radius('white')).toBeLessThan(radius('gray'));
		expect(radius('gray')).toBeLessThan(radius('red'));
		expect(radius('gray')).toBeLessThan(radius('blue'));
	});
});

describe('fontsByUse', () => {
	it('lists each typeface once per item with the items set in it, most used first', () => {
		const items = [
			item('a', { fonts: [{ family: 'Inter' }, { family: 'inter' }] }),
			item('b', { fonts: [{ family: 'GT America', internalName: 'GT America Bold' }] }),
			item('c', { fonts: [{ family: 'Inter' }, { family: 'GT America' }] }),
			item('d', { fonts: [{ family: 'Inter' }] }),
			item('e')
		];
		expect(fontsByUse(items)).toEqual([
			{ name: 'Inter', query: 'fontinter', itemIds: ['a', 'c', 'd'] },
			{ name: 'GT America', query: 'fontgtamerica', itemIds: ['b', 'c'] }
		]);
	});
});

describe('fontPairings', () => {
	const items = [
		item('a', { fonts: [{ family: 'Geist Mono' }, { family: 'Geist' }] }),
		item('b', { fonts: [{ family: 'Geist' }, { family: 'geist' }, { family: 'Geist Mono' }] }),
		item('c', { fonts: [{ family: 'Geist' }, { family: 'Inter' }] }),
		item('d', { fonts: [{ family: 'Inter' }, { family: 'Söhne' }] }),
		item('e', { fonts: [{ family: 'Inter' }, { family: 'Söhne' }] }),
		item('f', { fonts: [{ family: 'Inter' }, { family: 'Söhne' }] }),
		item('g', { fonts: [{ family: 'Inter' }] })
	];

	it('counts the typefaces set together on more than one site, most often first', () => {
		expect(fontPairings(items)).toEqual([
			{ a: 'Inter', b: 'Söhne', count: 3 },
			{ a: 'Geist', b: 'Geist Mono', count: 2 }
		]);
		expect(fontPairings(items, 1)).toHaveLength(1);
	});

	it('pairs a typeface however its name is spaced or cased, named as first seen', () => {
		const spelled = [
			item('a', { fonts: [{ family: 'Inter' }, { family: 'JetBrains Mono' }] }),
			item('b', { fonts: [{ family: 'Jetbrains Mono' }, { family: 'inter' }] }),
			item('c', { fonts: [{ family: 'Söhne' }, { family: 'Arial' }] }),
			item('d', { fonts: [{ family: 'Arial' }, { family: 'Sohne' }] })
		];
		// equal counts go by name
		expect(fontPairings(spelled)).toEqual([
			{ a: 'Arial', b: 'Söhne', count: 2 },
			{ a: 'Inter', b: 'JetBrains Mono', count: 2 }
		]);
	});
});

describe('countStyles', () => {
	it('counts a style once per item, most common first, ties by name', () => {
		const items = [
			item('a', { styles: ['bold', 'airy', 'airy'] }),
			item('b', { styles: ['airy'] }),
			item('c', { styles: ['calm', 'bold'] }),
			item('d')
		];
		expect(countStyles(items)).toEqual([
			{ name: 'airy', count: 2 },
			{ name: 'bold', count: 2 },
			{ name: 'calm', count: 1 }
		]);
	});
});

describe('styleGraph', () => {
	it('pairs the styles sharing an item whatever their order, never with themselves', () => {
		const { pairs } = styleGraph([
			item('a', { styles: ['y', 'x'] }),
			item('b', { styles: ['x', 'y', 'x'] }),
			item('c', { styles: ['z', 'x'] })
		]);
		expect(pairs).toEqual([
			{ a: 'x', b: 'y', count: 2 },
			{ a: 'x', b: 'z', count: 1 }
		]);
	});

	it('averages hues round the circle', () => {
		// hues of about 350 and 10, which average to red, not cyan
		const { styles } = styleGraph([
			item('a', { styles: ['warm'], paletteHex: ['#ff002b'] }),
			item('b', { styles: ['warm'], paletteHex: ['#ff2b00'] })
		]);
		const hue = styles[0].hue!;
		expect(Math.min(hue, 360 - hue)).toBeLessThan(1);
	});

	it('gives a mostly neutral style no hue', () => {
		const { styles } = styleGraph([
			item('a', { styles: ['mono'], paletteHex: ['#ffffff', '#000000', '#808080'] }),
			item('b', { styles: ['mostly'], paletteHex: ['#ff0000', ...Array(19).fill('#808080')] }),
			item('c', { styles: ['vivid'], paletteHex: ['#ff0000', '#808080'] })
		]);
		expect(styles.map((s) => [s.name, s.hue])).toEqual([
			['mono', null],
			['mostly', null],
			['vivid', 0]
		]);
	});
});

describe('hostOf', () => {
	it('reads a host off a url', () => {
		expect(hostOf('https://www.example.com/a?b=c')).toBe('example.com');
		expect(hostOf('nope')).toBeNull();
		expect(hostOf(undefined)).toBeNull();
	});
});
