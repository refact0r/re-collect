import { describe, expect, it } from 'vitest';
import { columnCountFor, columnWidthFor, fillColumns } from './masonry';

describe('fillColumns', () => {
	it('puts each card into the shortest column, the leftmost on a tie', () => {
		const fill = fillColumns([100, 50, 80, 30, 40], 3, 10);
		expect(fill.columns).toEqual([0, 1, 2, 1, 2]);
		expect(fill.tops).toEqual([0, 0, 0, 60, 90]);
		expect(fill.height).toBe(130);
		expect(fill.next).toBe(1);
		expect(fillColumns([50, 50, 50], 2, 0).columns).toEqual([0, 1, 0]);
	});

	it('fills a single column top to bottom', () => {
		const fill = fillColumns([10, 20, 30], 1, 5);
		expect(fill.columns).toEqual([0, 0, 0]);
		expect(fill.tops).toEqual([0, 15, 40]);
		expect(fill.height).toBe(70);
	});

	it('is empty with no cards', () => {
		expect(fillColumns([], 4, 16)).toEqual({ columns: [], tops: [], next: 0, height: 0 });
	});

	it('leaves columns empty when there are fewer cards than columns', () => {
		const fill = fillColumns([40, 60], 4, 16);
		expect(fill.columns).toEqual([0, 1]);
		expect(fill.next).toBe(2);
		expect(fill.height).toBe(60);
	});

	it('places a prefix the same whatever follows it', () => {
		const heights = [120, 80, 200, 40, 90, 160, 70];
		const whole = fillColumns(heights, 3, 16);
		const prefix = fillColumns(heights.slice(0, 4), 3, 16);
		expect(whole.columns.slice(0, 4)).toEqual(prefix.columns);
		expect(whole.tops.slice(0, 4)).toEqual(prefix.tops);
	});
});

describe('column count', () => {
	it('fits columns of at least 320px and applies the offset within bounds', () => {
		expect(columnCountFor(0, 0)).toBe(1);
		expect(columnCountFor(1000, 0, 16)).toBe(3);
		expect(columnCountFor(1000, -5, 16)).toBe(1);
		expect(columnCountFor(1000, 20, 16)).toBe(12);
		expect(columnWidthFor(1000, 3, 16)).toBeCloseTo((1000 - 32) / 3);
	});
});
