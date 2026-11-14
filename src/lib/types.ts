import type { ShownItem } from '../convex/items';

// Mirrors sortModeValidator / collectionSortModeValidator in convex/schema.ts
export type SortOption =
	| 'dateAddedNewest'
	| 'dateAddedOldest'
	| 'dateModifiedNewest'
	| 'dateModifiedOldest'
	| 'titleAsc'
	| 'titleDesc';
export type CollectionSortOption = 'manual' | SortOption;

// An item as pages hand it around: what a listing query returns (the whole doc
// for its owner, only the shown fields for a shared collection's visitor), plus
// its per-collection position.
export type DisplayItem = Omit<ShownItem, 'imageUrl'> & {
	imageUrl?: string | null;
	position?: string;
};

// Shape of the 'currentItems' context set by the app layout and consumed by
// pages and the item modal.
export type CurrentItemsContext = {
	items: DisplayItem[];
	setItems: (items: DisplayItem[]) => void;
};
