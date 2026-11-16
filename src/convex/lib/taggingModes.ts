import type { Doc } from '../_generated/dataModel';

// Which taggingModes each item type has, shared by the backend and the UI
// (src/lib/taggingModes.ts). Links can be looked at or read, images only
// looked at, notes only read; any item can have AI off.

export type TaggingMode = NonNullable<Doc<'items'>['taggingMode']>;
type ItemType = Doc<'items'>['type'];

export const TAGGING_MODES: Record<ItemType, readonly TaggingMode[]> = {
	url: ['visual', 'text', 'none'],
	image: ['visual', 'none'],
	text: ['text', 'none']
};

// An item's mode, undefined meaning its type's default
export const taggingModeOf = (item: Pick<Doc<'items'>, 'type' | 'taggingMode'>): TaggingMode =>
	item.taggingMode ?? (item.type === 'text' ? 'text' : 'visual');

// The mode an item stores for a requested one (undefined: its type's default).
// A mode its type lacks falls back to the type's own: an image asked to be read
// is looked at. Notes, always read, record only AI being off.
export function storedTaggingMode(type: ItemType, mode: TaggingMode | undefined) {
	if (type === 'text') return mode === 'none' ? mode : undefined;
	return mode && !TAGGING_MODES[type].includes(mode) ? 'visual' : mode;
}
