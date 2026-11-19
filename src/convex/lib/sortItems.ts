import type { Infer } from 'convex/values';
import type { Doc } from '../_generated/dataModel';
import type { sortModeValidator } from '../schema';

// Item sorts, shared by the backend (a collection's items) and the home page,
// which sorts the library it already holds

export type SortMode = Infer<typeof sortModeValidator>;

type Sortable = Pick<Doc<'items'>, 'title' | 'url' | 'dateAdded' | 'dateModified'>;

// `||`: older rows may hold title: ''
const sortTitle = (item: Sortable) => (item.title || item.url || '').toLowerCase();

export const compareItems: Record<SortMode, (a: Sortable, b: Sortable) => number> = {
	dateAddedNewest: (a, b) => b.dateAdded - a.dateAdded,
	dateAddedOldest: (a, b) => a.dateAdded - b.dateAdded,
	dateModifiedNewest: (a, b) => b.dateModified - a.dateModified,
	dateModifiedOldest: (a, b) => a.dateModified - b.dateModified,
	titleAsc: (a, b) => sortTitle(a).localeCompare(sortTitle(b)),
	titleDesc: (a, b) => sortTitle(b).localeCompare(sortTitle(a))
};

// The library, given newest first (items.list's order), in another sort. Ties
// keep the order the date indexes give: newest first in the newest-first sorts,
// oldest first in the rest (title sorts included).
export function sortLibrary<T extends Sortable>(newestFirst: T[], sortBy: SortMode): T[] {
	if (sortBy === 'dateAddedNewest') return newestFirst;
	const base = sortBy.endsWith('Newest') ? [...newestFirst] : [...newestFirst].reverse();
	return sortBy === 'dateAddedOldest' ? base : base.sort(compareItems[sortBy]);
}
