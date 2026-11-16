import { describe, expect, it } from 'vitest';
import { spring } from './spring';

const points = (easing: string) => easing.slice(7, -1).split(',').map(Number);

describe('spring', () => {
	it('runs from 0 to 1', () => {
		const p = points(spring(900, 39).easing);
		expect(p[0]).toBe(0);
		expect(p.at(-1)).toBe(1);
	});

	it('overshoots a little when underdamped and lasts until it settles', () => {
		const { duration, easing } = spring(900, 39);
		expect(Math.max(...points(easing))).toBeGreaterThan(1.03);
		expect(duration).toBeGreaterThan(250);
		expect(duration).toBeLessThan(500);
	});

	it('never overshoots when overdamped', () => {
		expect(Math.max(...points(spring(100, 40).easing))).toBe(1);
	});
});
