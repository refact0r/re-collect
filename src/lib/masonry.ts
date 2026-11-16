// The masonry grid's column math, shared by the item grid and the discover feed.
// The grid's gap is var(--gutter), which narrows on small screens, so a grid reads
// its real gap (gapOf) and passes it in; GAP is the desktop value.
export const GAP = 16;
const MIN_COL_WIDTH = 320;
const MAX_COLS = 6; // for the width-derived count, before the user's offset
const MAX_OFFSET_COLS = 12;

export function gapOf(grid: HTMLElement) {
	return parseFloat(getComputedStyle(grid).columnGap) || GAP;
}

// Columns that fit the width, shifted by the user's +/- offset
export function columnCountFor(width: number, offset: number, gap = GAP) {
	const auto =
		width === 0
			? 1
			: Math.min(MAX_COLS, Math.max(1, Math.floor((width + gap) / (MIN_COL_WIDTH + gap))));
	return Math.min(MAX_OFFSET_COLS, Math.max(1, auto + offset));
}

export function columnWidthFor(width: number, count: number, gap = GAP) {
	return (width - (count - 1) * gap) / count;
}
