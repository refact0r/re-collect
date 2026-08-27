import type { Doc } from '../convex/_generated/dataModel';

// Mirrors sortModeValidator / collectionSortModeValidator in convex/schema.ts
export type SortOption =
	| 'dateAddedNewest'
	| 'dateAddedOldest'
	| 'dateModifiedNewest'
	| 'dateModifiedOldest'
	| 'titleAsc'
	| 'titleDesc';
export type CollectionSortOption = 'manual' | SortOption;

// An item as pages hand it around: the stored doc plus fields queries attach
// (resolved image URL, per-collection position).
export type DisplayItem = Doc<'items'> & {
	imageUrl?: string | null;
	position?: string;
};

// Shape of the 'currentItems' context set by the app layout and consumed by
// pages and the item modal.
export type CurrentItemsContext = {
	items: DisplayItem[];
	setItems: (items: DisplayItem[]) => void;
};
