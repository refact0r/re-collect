import { describe, it, expect } from 'vitest';
import type { Id } from '../convex/_generated/dataModel';
import {
	colorStrips,
	colorWheel,
	findRegions,
	fontPairings,
	hostOf,
	litItems,
	monthsOf,
	noLenses,
	recentShift,
	fontsByUse,
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

	it('spirals the neutrals in the middle, lightest first', () => {
		expect(wheel.get(id('white'))).toEqual({ x: Math.sqrt(0.5), y: 0 });
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
});

describe('hostOf', () => {
	it('reads a host off a url', () => {
		expect(hostOf('https://www.example.com/a?b=c')).toBe('example.com');
		expect(hostOf('nope')).toBeNull();
		expect(hostOf(undefined)).toBeNull();
	});
});
