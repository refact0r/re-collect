import type { Doc } from '../convex/_generated/dataModel.js';
import { TAGGING_MODES, type TaggingMode } from '../convex/lib/taggingModes.js';

export { taggingModeOf, type TaggingMode } from '../convex/lib/taggingModes.js';

export const TAGGING_MODE_LABEL = 'understood by';

export const taggingModeOptions = [
	{ value: 'visual', label: 'look' },
	{ value: 'text', label: 'content' },
	{ value: 'none', label: 'off' }
] as const satisfies readonly { value: TaggingMode; label: string }[];

export const linkImageModeOptions = [
	{ value: 'screenshot', label: 'screenshot' },
	{ value: 'og', label: 'og image' }
] as const satisfies readonly { value: Doc<'items'>['linkImageMode']; label: string }[];

// The modes an item can switch between
export const taggingModesFor = (type: Doc<'items'>['type']) =>
	taggingModeOptions.filter((opt) => TAGGING_MODES[type].includes(opt.value));
