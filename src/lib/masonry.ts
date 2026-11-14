// The masonry grid's column math, shared by the item grid and the discover feed
export const GAP = 16;
const MIN_COL_WIDTH = 320;
const MAX_COLS = 6; // for the width-derived count, before the user's offset
const MAX_OFFSET_COLS = 12;

// Columns that fit the width, shifted by the user's +/- offset
export function columnCountFor(width: number, offset: number) {
	const auto =
		width === 0
			? 1
			: Math.min(MAX_COLS, Math.max(1, Math.floor((width + GAP) / (MIN_COL_WIDTH + GAP))));
	return Math.min(MAX_OFFSET_COLS, Math.max(1, auto + offset));
}

export function columnWidthFor(width: number, count: number) {
	return (width - (count - 1) * GAP) / count;
}
