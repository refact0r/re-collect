import { UMAP } from 'umap-js';

// The library map's layout math: UMAP down to 2D, then a similarity transform
// onto the previous layout so the map holds still as items come and go. Holds
// no Convex functions, so the map action and plain specs can both import it.

export type Point = [number, number];
export interface MapPoint<Id extends string = string> {
	itemId: Id;
	x: number;
	y: number;
}

const SEED = 0x5eed;
const MAX_NEIGHBORS = 15;
// Below this UMAP has too few neighbours to work with; the points go on a circle
const MIN_UMAP_POINTS = 4;
// Pairs needed to fix a rotation and scale without a degenerate fit
const MIN_SHARED_POINTS = 3;

// mulberry32: small and fast, enough for layout randomness
export function seededRandom(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// Embeddings are unit length, so the dot product is the cosine
function cosineDistance(a: number[], b: number[]) {
	let dot = 0;
	for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
	return 1 - dot;
}

export function umapLayout(vectors: number[][]): Point[] {
	const n = vectors.length;
	if (n < MIN_UMAP_POINTS) {
		if (n === 1) return [[0, 0]];
		return vectors.map((_, i) => [
			Math.cos((2 * Math.PI * i) / n),
			Math.sin((2 * Math.PI * i) / n)
		]);
	}
	const umap = new UMAP({
		nComponents: 2,
		nNeighbors: Math.min(MAX_NEIGHBORS, n - 1),
		minDist: 0.2,
		distanceFn: cosineDistance,
		random: seededRandom(SEED)
	});
	return umap.fit(vectors) as Point[];
}

const mean = (points: Point[]): Point => {
	let x = 0;
	let y = 0;
	for (const p of points) {
		x += p[0];
		y += p[1];
	}
	return [x / points.length, y / points.length];
};

// The least-squares similarity transform (rotation or reflection, uniform
// scale, translation) taking `from[i]` onto `to[i]`, or null when the pairs
// can't pin one down
export function procrustes(from: Point[], to: Point[]): ((p: Point) => Point) | null {
	if (from.length < MIN_SHARED_POINTS || from.length !== to.length) return null;
	const [fx, fy] = mean(from);
	const [tx, ty] = mean(to);
	// h = Σ a bᵀ over the centered pairs, and Σ |a|²
	let h00 = 0;
	let h01 = 0;
	let h10 = 0;
	let h11 = 0;
	let norm = 0;
	for (let i = 0; i < from.length; i++) {
		const ax = from[i][0] - fx;
		const ay = from[i][1] - fy;
		const bx = to[i][0] - tx;
		const by = to[i][1] - ty;
		h00 += ax * bx;
		h01 += ax * by;
		h10 += ay * bx;
		h11 += ay * by;
		norm += ax * ax + ay * ay;
	}
	// The best rotation and the best reflection each have a closed form in 2D;
	// keep whichever lines the points up better
	const rotation = Math.hypot(h00 + h11, h01 - h10);
	const reflection = Math.hypot(h00 - h11, h01 + h10);
	if (norm < 1e-12 || Math.max(rotation, reflection) < 1e-12) return null;
	const reflect = reflection > rotation;
	const angle = reflect ? Math.atan2(h01 + h10, h00 - h11) : Math.atan2(h01 - h10, h00 + h11);
	const scale = Math.max(rotation, reflection) / norm;
	const c = Math.cos(angle) * scale;
	const s = Math.sin(angle) * scale;
	// rotation [[c, -s], [s, c]], reflection [[c, s], [s, -c]]
	return ([x, y]) => {
		const ax = x - fx;
		const ay = y - fy;
		return reflect
			? [c * ax + s * ay + tx, s * ax - c * ay + ty]
			: [c * ax - s * ay + tx, s * ax + c * ay + ty];
	};
}

// Centers the bounding box on the origin and scales the longer side to [-1, 1]
export function normalize(points: Point[]): Point[] {
	if (points.length === 0) return [];
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const [x, y] of points) {
		minX = Math.min(minX, x);
		minY = Math.min(minY, y);
		maxX = Math.max(maxX, x);
		maxY = Math.max(maxY, y);
	}
	const cx = (minX + maxX) / 2;
	const cy = (minY + maxY) / 2;
	const half = Math.max(maxX - minX, maxY - minY) / 2 || 1;
	return points.map(([x, y]) => [(x - cx) / half, (y - cy) / half]);
}

// Lays the items out from their vectors and aligns the result to the previous
// layout on the items both share
export function layoutMap<Id extends string>(
	itemIds: Id[],
	vectors: number[][],
	previous: MapPoint<Id>[] = []
): MapPoint<Id>[] {
	let points = umapLayout(vectors);
	const before = new Map(previous.map((p) => [p.itemId, [p.x, p.y] as Point]));
	const from: Point[] = [];
	const to: Point[] = [];
	itemIds.forEach((id, i) => {
		const old = before.get(id);
		if (old) {
			from.push(points[i]);
			to.push(old);
		}
	});
	const align = procrustes(from, to);
	if (align) points = points.map(align);
	const round = (v: number) => Math.round(v * 1e4) / 1e4;
	return normalize(points).map(([x, y], i) => ({ itemId: itemIds[i], x: round(x), y: round(y) }));
}
