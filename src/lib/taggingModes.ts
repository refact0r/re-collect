import type { Doc } from '../convex/_generated/dataModel.js';
import { TAGGING_MODES, type TaggingMode } from '../convex/lib/taggingModes.js';

// taggingMode as the UI names it: how the app understands an item, which its
// tagging, embedding and place on the atlas map follow (see schema.ts)
export { taggingModeOf, type TaggingMode } from '../convex/lib/taggingModes.js';

export const TAGGING_MODE_LABEL = 'understood by';

export const taggingModeOptions = [
	{ value: 'visual', label: 'look' },
	{ value: 'text', label: 'content' },
	{ value: 'none', label: 'off' }
] as const satisfies readonly { value: TaggingMode; label: string }[];

// The modes an item can switch between
export const taggingModesFor = (type: Doc<'items'>['type']) =>
	taggingModeOptions.filter((opt) => TAGGING_MODES[type].includes(opt.value));
