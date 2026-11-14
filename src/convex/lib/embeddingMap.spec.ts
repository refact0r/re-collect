import { describe, it, expect } from 'vitest';
import {
	layoutMap,
	normalize,
	procrustes,
	seededRandom,
	umapLayout,
	type Point
} from './embeddingMap';

const close = (a: Point, b: Point) => {
	expect(a[0]).toBeCloseTo(b[0], 6);
	expect(a[1]).toBeCloseTo(b[1], 6);
};

const square: Point[] = [
	[0, 0],
	[1, 0],
	[1, 2],
	[0, 2],
	[0.3, 0.7]
];

// Random unit vectors around a few centers, so UMAP has clusters to find
function clusteredVectors(n: number, dims = 16): number[][] {
	const random = seededRandom(7);
	const centers = [0, 1, 2].map(() => Array.from({ length: dims }, () => random() - 0.5));
	return Array.from({ length: n }, (_, i) => {
		const v = centers[i % 3].map((c) => c + (random() - 0.5) * 0.1);
		const length = Math.hypot(...v);
		return v.map((x) => x / length);
	});
}

describe('procrustes', () => {
	it('recovers a rotation, scale and translation', () => {
		const angle = 1.1;
		const moved = square.map(([x, y]): Point => [
			3 * (Math.cos(angle) * x - Math.sin(angle) * y) + 5,
			3 * (Math.sin(angle) * x + Math.cos(angle) * y) - 2
		]);
		const align = procrustes(square, moved)!;
		square.forEach((p, i) => close(align(p), moved[i]));
	});

	it('recovers a reflection', () => {
		const mirrored = square.map(([x, y]): Point => [-x + 1, y]);
		const align = procrustes(square, mirrored)!;
		square.forEach((p, i) => close(align(p), mirrored[i]));
	});

	it('gives up without enough distinct pairs', () => {
		expect(procrustes(square.slice(0, 2), square.slice(0, 2))).toBeNull();
		const stacked = Array.from({ length: 3 }, (): Point => [1, 1]);
		expect(procrustes(stacked, square.slice(0, 3))).toBeNull();
	});
});

describe('normalize', () => {
	it('centers the points and fits the longer side to [-1, 1]', () => {
		expect(normalize(square)).toEqual([
			[-0.5, -1],
			[0.5, -1],
			[0.5, 1],
			[-0.5, 1],
			[-0.2, -0.30000000000000004]
		]);
	});
});

describe('umapLayout', () => {
	it('is deterministic', () => {
		const vectors = clusteredVectors(30);
		expect(umapLayout(vectors)).toEqual(umapLayout(vectors));
	});

	it('handles tiny libraries', () => {
		expect(umapLayout([])).toEqual([]);
		expect(umapLayout(clusteredVectors(1))).toEqual([[0, 0]]);
		expect(umapLayout(clusteredVectors(3))).toHaveLength(3);
		expect(umapLayout(clusteredVectors(4))).toHaveLength(4);
	});
});

describe('layoutMap', () => {
	it('keeps the old points in place when an item is added', () => {
		const vectors = clusteredVectors(40);
		const ids = vectors.map((_, i) => `item${i}`);
		const before = layoutMap(ids.slice(0, 39), vectors.slice(0, 39));
		const after = layoutMap(ids, vectors, before);
		const old = new Map(before.map((p) => [p.itemId, p]));
		let drift = 0;
		for (const p of after) {
			const q = old.get(p.itemId);
			if (q) drift += Math.hypot(p.x - q.x, p.y - q.y);
		}
		// across a [-1, 1] map, a flipped or rotated layout would drift ~1 per point
		expect(drift / before.length).toBeLessThan(0.25);
		for (const p of after) {
			expect(Math.abs(p.x)).toBeLessThanOrEqual(1);
			expect(Math.abs(p.y)).toBeLessThanOrEqual(1);
		}
	});
});
