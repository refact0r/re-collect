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
