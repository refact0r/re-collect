import { describe, expect, it } from 'vitest';
import { columnCountFor, columnWidthFor, fillColumns, nearestColumn, nearestSlot } from './masonry';

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

describe('drop targets', () => {
	it('picks the column whose left edge is nearest, within bounds', () => {
		expect(nearestColumn(0, 100, 3, 10)).toBe(0);
		expect(nearestColumn(54, 100, 3, 10)).toBe(0);
		expect(nearestColumn(56, 100, 3, 10)).toBe(1);
		expect(nearestColumn(-80, 100, 3, 10)).toBe(0);
		expect(nearestColumn(500, 100, 3, 10)).toBe(2);
	});

	it('picks the slot whose top is nearest, counting only that column', () => {
		// Column 0 holds the cards 100 and 60 tall, at 0 and 110, so its slots start at 0,
		// 110 and 180; column 1 holds the rest
		const heights = [100, 30, 40, 30, 60];
		const fill = fillColumns(heights, 2, 10);
		expect(fill.columns).toEqual([0, 1, 1, 1, 0]);
		const slot = (y: number) => nearestSlot(fill, heights, 0, y, 10);
		expect([-50, 0, 54, 56, 110, 144, 146, 400].map(slot)).toEqual([0, 0, 0, 1, 1, 1, 2, 2]);
	});

	it('passes a neighbour once covering half of it and its gap, down as up', () => {
		// One column of cards 100, 40 and 60 tall: the slot at 110 sits between the first two
		const heights = [100, 40, 60];
		const fill = fillColumns(heights, 1, 10);
		const slot = (y: number) => nearestSlot(fill, heights, 0, y, 10);
		expect(slot(110)).toBe(1);
		expect(slot(110 - 54)).toBe(1);
		expect(slot(110 - 56)).toBe(0);
		expect(slot(110 + 24)).toBe(1);
		expect(slot(110 + 26)).toBe(2);
	});

	it('targets the top of an empty column', () => {
		expect(nearestSlot(fillColumns([80], 3, 10), [80], 2, 300, 10)).toBe(0);
	});
});
