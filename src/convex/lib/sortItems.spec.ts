import { expect, test } from 'vitest';
import { sortLibrary, type SortMode } from './sortItems';

const item = (id: string, dateAdded: number, dateModified: number, title?: string) => ({
	id,
	dateAdded,
	dateModified,
	title,
	url: `https://${id}.co`
});
// Newest first, as items.list returns the library; b and c tie on everything but age
const library = [
	item('d', 4, 1, 'apple'),
	item('c', 3, 5, 'pear'),
	item('b', 2, 5, 'pear'),
	item('a', 1, 2, 'fig')
];
const sorted = (sortBy: SortMode) => sortLibrary(library, sortBy).map((i) => i.id);

test('date sorts order ties as the date indexes do', () => {
	expect(sorted('dateAddedNewest')).toEqual(['d', 'c', 'b', 'a']);
	expect(sorted('dateAddedOldest')).toEqual(['a', 'b', 'c', 'd']);
	expect(sorted('dateModifiedNewest')).toEqual(['c', 'b', 'a', 'd']);
	expect(sorted('dateModifiedOldest')).toEqual(['d', 'a', 'b', 'c']);
});

test('title sorts put ties oldest first', () => {
	expect(sorted('titleAsc')).toEqual(['d', 'a', 'b', 'c']);
	expect(sorted('titleDesc')).toEqual(['b', 'c', 'a', 'd']);
});

test('a stored empty title sorts by url, not first', () => {
	const legacy = item('zine', 1, 1, '');
	const titled = item('b', 2, 2, 'apple');
	expect(sortLibrary([titled, legacy], 'titleAsc')).toEqual([titled, legacy]);
});

test('the library isn’t reordered in place', () => {
	const copy = [...library];
	sortLibrary(library, 'titleAsc');
	expect(library).toEqual(copy);
});
