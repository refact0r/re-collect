import { describe, it, expect } from 'vitest';
import type { Id } from '../convex/_generated/dataModel';
import { mergeSearch, SIMILAR_LIMIT } from './searchMerge';

const id = (name: string) => name as Id<'items'>;
const item = (name: string) => ({ _id: id(name) });
const lookup = (name: Id<'items'>) => item(name);
const names = (items: { _id: Id<'items'> }[]) => items.map((i) => i._id);

describe('mergeSearch', () => {
	it('keeps keyword order when there are no neighbours', () => {
		const result = mergeSearch([item('a'), item('b'), item('c')], [], lookup);
		expect(names(result.matches)).toEqual(['a', 'b', 'c']);
		expect(result.similar).toEqual([]);
	});

	it('lifts keyword matches that are also near the query', () => {
		const result = mergeSearch([item('a'), item('b'), item('c')], [id('c'), id('x')], lookup);
		expect(names(result.matches)).toEqual(['c', 'a', 'b']);
	});

	it('offers unmatched neighbours as similar, nearest first, without repeating matches', () => {
		const result = mergeSearch([item('a')], [id('x'), id('a'), id('y')], lookup);
		expect(names(result.similar)).toEqual(['x', 'y']);
	});

	it('skips neighbours it can’t find and caps the similar list', () => {
		const nearest = Array.from({ length: SIMILAR_LIMIT + 10 }, (_, i) => id(`n${i}`));
		const result = mergeSearch([], [id('gone'), ...nearest], (name) =>
			name === 'gone' ? undefined : item(name)
		);
		expect(result.similar).toHaveLength(SIMILAR_LIMIT);
		expect(result.similar[0]._id).toBe('n0');
	});
});
