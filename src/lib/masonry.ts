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

export interface Fill {
	/** Each card's column, parallel to the heights */
	columns: number[];
	/** Each card's top edge */
	tops: number[];
	/** The column a further card would go into */
	next: number;
	/** The tallest column's height */
	height: number;
}

/** Greedy masonry: each card in turn goes into the shortest column, the leftmost on a tie */
export function fillColumns(heights: number[], count: number, gap: number): Fill {
	const bottoms: number[] = Array(count).fill(0);
	const shortest = () => bottoms.indexOf(Math.min(...bottoms));
	const columns: number[] = [];
	const tops: number[] = [];
	for (const height of heights) {
		const column = shortest();
		columns.push(column);
		tops.push(bottoms[column]);
		bottoms[column] += height + gap;
	}
	return {
		columns,
		tops,
		next: shortest(),
		height: heights.length ? Math.max(...bottoms) - gap : 0
	};
}

/** The column whose left edge is nearest x */
export function nearestColumn(x: number, columnWidth: number, count: number, gap: number) {
	return Math.max(0, Math.min(count - 1, Math.round(x / (columnWidth + gap))));
}

/**
 * The slot in a column (the index among its cards, or their count for its end) whose top
 * is nearest y: a card dropped with its top edge at y passes a card of the column once
 * it covers half of it and its gap, the same distance down as up
 */
export function nearestSlot(fill: Fill, heights: number[], column: number, y: number, gap: number) {
	const { columns, tops } = fill;
	return columns.filter((c, i) => c === column && y > tops[i] + (heights[i] + gap) / 2).length;
}
