import type { Doc } from '../convex/_generated/dataModel.js';

// taggingMode as the UI names it: how the app understands an item, which its
// tagging, embedding and place on the atlas map follow (see schema.ts)
export type TaggingMode = NonNullable<Doc<'items'>['taggingMode']>;

export const TAGGING_MODE_LABEL = 'understood by';

export const taggingModeOptions = [
	{ value: 'visual', label: 'look' },
	{ value: 'text', label: 'content' },
	{ value: 'none', label: 'off' }
] as const satisfies readonly { value: TaggingMode; label: string }[];

// The modes an item can switch between: images are only looked at, and notes
// only read
export function taggingModesFor(type: Doc<'items'>['type']) {
	if (type === 'url') return taggingModeOptions;
	const own = type === 'image' ? 'visual' : 'text';
	return taggingModeOptions.filter((opt) => opt.value === own || opt.value === 'none');
}

// An item's mode, undefined meaning its type's default
export const taggingModeOf = (item: Pick<Doc<'items'>, 'type' | 'taggingMode'>): TaggingMode =>
	item.taggingMode ?? (item.type === 'text' ? 'text' : 'visual');
