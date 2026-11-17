import type { ShownItem } from '../convex/items';

// Mirrors sortModeValidator / collectionSortModeValidator in convex/schema.ts
type SortOption =
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
export type DisplayItem = Omit<ShownItem, 'imageUrl' | 'imageSrcset'> & {
	imageUrl?: string | null;
	imageSrcset?: string | null;
	position?: string;
};
