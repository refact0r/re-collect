<script lang="ts">
	import { generateKeyBetween } from 'fractional-indexing';
	import { prepare, layout, type PreparedText } from '@chenglou/pretext';
	import { onDestroy } from 'svelte';
	import { api } from '../../convex/_generated/api.js';
	import type { Id } from '../../convex/_generated/dataModel.js';
	import { useDeleteItem, useMutation } from '#lib/convex.js';
	import { pointerDrag } from '#lib/pointerDrag.js';
	import { shouldDisplayAsImage, getItemUrl, isBusy } from '#lib/itemDisplay.js';
	import { GAP, columnCountFor, columnWidthFor, gapOf } from '#lib/masonry.js';
	import type { DisplayItem } from '#lib/types.js';
	import IconSchedule from '~icons/material-symbols-light/schedule-outline-sharp';
	import IconError from '~icons/material-symbols-light/error-outline-sharp';

	const mutate = useMutation();
	const deleteItem = useDeleteItem();

	interface Props {
		items: DisplayItem[];
		columnOffset?: number;
		showTitles?: boolean;
		onReorder?: (itemId: Id<'items'>, newPosition: string) => void;
		// Someone else's items (a shared collection): no retry or delete
		readonly?: boolean;
	}

	let {
		items,
		columnOffset = 0,
		showTitles = false,
		onReorder,
		readonly = false
	}: Props = $props();

	const isDraggable = $derived(!!onReorder);

	let containerElement: HTMLDivElement | undefined = $state();
	let containerWidth = $state(0);

	// Layout constants. The card chrome mirrors the CSS and must match it: .card padding is
	// --card-pad (8px) on each side, --space-xs (4px) at the bottom when titled, plus a 1px
	// border; TEXT_CARD_PADDING is .text-card's --card-pad on both sides
	const CARD_BORDER = 2; // 1px * 2
	const CARD_CHROME_X = 16 + CARD_BORDER; // 8px * 2 + border = 18px
	const CARD_CHROME_Y_TITLED = 12 + CARD_BORDER; // 8px + 4px + border = 14px
	const CARD_CHROME_Y = 16 + CARD_BORDER; // 8px * 2 + border = 18px
	const TITLE_HEIGHT = 25;
	const IMAGE_FALLBACK_ASPECT = 0.75;
	const TEXT_CARD_PADDING = 16;
	const TEXT_LINE_HEIGHT = 24;
	const TEXT_MAX_LINES = 10;
	const DEFAULT_HEIGHT = 100;
	const TEXT_FONT = '16px DM Sans';

	// Pretext cache: prepared text measurements keyed by `${itemId}:${text}`
	const preparedTexts = new Map<string, PreparedText>();

	function getPreparedText(item: DisplayItem): PreparedText | null {
		const text = getItemText(item);
		if (!text) return null;

		const cacheKey = `${item._id}:${text}`;
		const cached = preparedTexts.get(cacheKey);
		if (cached) return cached;

		const prepared = prepare(text, TEXT_FONT, { whiteSpace: 'pre-wrap' });
		preparedTexts.set(cacheKey, prepared);
		return prepared;
	}

	function getItemText(item: DisplayItem): string | null {
		if (item.type === 'text') return item.content ?? null;
		if (
			item.type === 'url' &&
			!shouldDisplayAsImage(item) &&
			!(item.screenshotStatus && item.screenshotStatus !== 'completed')
		) {
			return item.url ?? null;
		}
		return null;
	}

	// Read again whenever the width changes, which it does when the gap does
	const gap = $derived(containerElement && containerWidth ? gapOf(containerElement) : GAP);
	const columnCount = $derived(columnCountFor(containerWidth, columnOffset, gap));
	const columnWidth = $derived(columnWidthFor(containerWidth, columnCount, gap));

	const chromeY = $derived(showTitles ? CARD_CHROME_Y_TITLED : CARD_CHROME_Y);

	function estimateHeight(item: DisplayItem): number {
		const titleHeight = showTitles && item.title ? TITLE_HEIGHT : 0;
		const innerWidth = columnWidth - CARD_CHROME_X;

		if (shouldDisplayAsImage(item)) {
			if (item.imageWidth && item.imageHeight) {
				const imageHeight = innerWidth * (item.imageHeight / item.imageWidth);
				return imageHeight + chromeY + titleHeight;
			}
			return innerWidth * IMAGE_FALLBACK_ASPECT + chromeY + titleHeight;
		}

		if (item.type === 'url' && item.screenshotStatus && item.screenshotStatus !== 'completed') {
			const screenshotHeight = innerWidth * (900 / 1440);
			return screenshotHeight + chromeY + titleHeight;
		}

		if (item.type === 'url' || item.type === 'text') {
			const prepared = getPreparedText(item);
			if (prepared) {
				const textWidth = innerWidth - TEXT_CARD_PADDING;
				const result = layout(prepared, textWidth, TEXT_LINE_HEIGHT);
				// CSS max-height is calc(1.5rem * 10 - 0.125rem) = 238px
				const maxTextHeight = TEXT_MAX_LINES * TEXT_LINE_HEIGHT - 2;
				const clampedHeight = Math.min(result.height, maxTextHeight);
				return clampedHeight + TEXT_CARD_PADDING + chromeY + titleHeight;
			}
			return DEFAULT_HEIGHT + chromeY + titleHeight;
		}

		return DEFAULT_HEIGHT + chromeY + titleHeight;
	}

	// ============ MASONRY LAYOUT ============
	type GridCell = DisplayItem | { _id: 'placeholder'; height: number };
	type Placeholder = { col: number; slot: number; height: number };
	type Layout = { columns: GridCell[][]; before: DisplayItem | null; after: DisplayItem | null };

	/**
	 * Greedy masonry: each item goes into the currently shortest column. A placeholder
	 * is inserted where the fill reaches its column + slot (before/after are its flat-order
	 * neighbors); returns null if the fill never reaches that spot.
	 */
	function fillColumns(
		list: DisplayItem[],
		heights: number[],
		placeholder?: Placeholder
	): Layout | null {
		if (columnWidth === 0) return null;

		const columns: GridCell[][] = Array.from({ length: columnCount }, () => []);
		const columnHeights = Array(columnCount).fill(0);
		const shortest = () => columnHeights.indexOf(Math.min(...columnHeights));
		let neighbors: Pick<Layout, 'before' | 'after'> | null = null;

		for (let i = 0; i <= list.length; i++) {
			if (
				placeholder &&
				!neighbors &&
				shortest() === placeholder.col &&
				columns[placeholder.col].length === placeholder.slot
			) {
				columns[placeholder.col].push({ _id: 'placeholder', height: placeholder.height });
				columnHeights[placeholder.col] += placeholder.height + gap;
				neighbors = { before: list[i - 1] ?? null, after: list[i] ?? null };
			}
			if (i === list.length) break;
			const col = shortest();
			columns[col].push(list[i]);
			columnHeights[col] += heights[i] + gap;
		}

		if (placeholder && !neighbors) return null;
		return { columns, before: null, after: null, ...neighbors };
	}

	const normalColumns = $derived(
		(fillColumns(items, items.map(estimateHeight))?.columns ?? []) as DisplayItem[][]
	);

	// ============ DRAG ============
	let draggedItem: DisplayItem | null = $state(null);
	let previewPosition = $state({ x: 0, y: 0 });
	// The layout with a placeholder at the drop target (null when the target is unreachable)
	let simulation = $state.raw<Layout | null>(null);
	let cancelDrag: (() => void) | null = null;

	// Taken at drag start: the layout doesn't change mid-drag, so heights and slot
	// boundaries are computed once instead of on every move
	let drag: {
		offset: { x: number; y: number }; // pointer position within the card
		others: DisplayItem[]; // flat order without the dragged item
		heights: number[]; // parallel to others
		height: number; // the dragged item's, for the placeholder
		slotMidpoints: number[][]; // per column of the original layout
		target: { col: number; slot: number };
	} | null = null;

	const displayColumns: GridCell[][] = $derived(simulation?.columns ?? normalColumns);

	function getColumnFromCursorX(cursorX: number, containerRect: DOMRect): number {
		const col = Math.floor((cursorX - containerRect.left) / (columnWidth + gap));
		return Math.max(0, Math.min(columnCount - 1, col));
	}

	// Vertical midpoints of each card in a column of the original layout; the cursor
	// targets the slot of the first card whose midpoint is below it
	function getSlotMidpoints(column: DisplayItem[]): number[] {
		let y = 0;
		return column.map((item) => {
			const height = estimateHeight(item);
			const midpoint = y + height / 2;
			y += height + gap;
			return midpoint;
		});
	}

	function getSlotFromCursorY(
		cursorY: number,
		containerRect: DOMRect,
		midpoints: number[]
	): number {
		const slot = midpoints.findIndex((midpoint) => cursorY - containerRect.top < midpoint);
		return slot === -1 ? midpoints.length : slot;
	}

	function simulate(col: number, slot: number) {
		return drag && fillColumns(drag.others, drag.heights, { col, slot, height: drag.height });
	}

	function handlePointerDown(item: DisplayItem, e: PointerEvent) {
		const card = e.currentTarget as HTMLElement;
		cancelDrag = pointerDrag(e, {
			start: (x, y) => handleDragStart(item, card, x, y),
			move: handleDragMove,
			end: handleDragEnd
		});
	}

	function handleDragStart(item: DisplayItem, card: HTMLElement, x: number, y: number) {
		const rect = card.getBoundingClientRect();
		const col = normalColumns.findIndex((column) => column.some((i) => i._id === item._id));
		const slot = normalColumns[col]?.findIndex((i) => i._id === item._id) ?? -1;
		const others = items.filter((i) => i._id !== item._id);
		drag = {
			offset: { x: x - rect.left, y: y - rect.top },
			others,
			heights: others.map(estimateHeight),
			height: estimateHeight(item),
			slotMidpoints: normalColumns.map(getSlotMidpoints),
			target: { col, slot }
		};
		draggedItem = item;
		previewPosition = { x: rect.left, y: rect.top };
		simulation = simulate(col, slot);
	}

	// Also runs when the page scrolls under a still pointer, so the target follows the content
	function handleDragMove(x: number, y: number) {
		if (!drag || !containerElement) return;
		previewPosition = { x: x - drag.offset.x, y: y - drag.offset.y };

		// Slots come from the ORIGINAL layout (with the dragged item), which is what the user sees
		const containerRect = containerElement.getBoundingClientRect();
		const col = getColumnFromCursorX(x, containerRect);
		const slot = getSlotFromCursorY(y, containerRect, drag.slotMidpoints[col] ?? []);

		// Most moves stay over the same slot; only re-run the layout when the target changes
		if (col === drag.target.col && slot === drag.target.slot) return;
		drag.target = { col, slot };
		simulation = simulate(col, slot);
	}

	function handleDragEnd(commit: boolean) {
		const dragged = draggedItem;
		const drop = simulation;
		draggedItem = null;
		simulation = null;
		drag = null;
		cancelDrag = null;
		if (!commit || !dragged || !drop || !onReorder) return;

		// Dropped back between its current neighbors: nothing to save
		const index = items.findIndex((i) => i._id === dragged._id);
		if (drop.before?._id === items[index - 1]?._id && drop.after?._id === items[index + 1]?._id) {
			return;
		}

		const beforePos = drop.before?.position ?? null;
		const afterPos = drop.after?.position ?? null;
		// fractional-indexing needs before < after
		if (beforePos !== null && afterPos !== null && beforePos >= afterPos) return;
		onReorder(dragged._id, generateKeyBetween(beforePos, afterPos));
	}

	// Drop the drag's document listeners if the grid unmounts mid-drag
	onDestroy(() => cancelDrag?.());
</script>

<!-- The link wraps the card's content but not its buttons, which can't sit inside a
	link: its ::after (.card-link in app.css) stretches it over the whole card, and
	the buttons sit above that. The drag preview passes no href, so has no link. -->
{#snippet cardContent(item: DisplayItem, href?: string)}
	{#if item.type === 'url' && !shouldDisplayAsImage(item) && item.screenshotStatus === 'failed'}
		<div class="url-card url-failed">
			<svelte:element this={href ? 'a' : 'div'} {href} class="card-link failed-content">
				<div class="failed-icon">
					<IconError />
				</div>
				<span class="url-text">{item.url}</span>
				{#if item.screenshotError}
					<span class="error-text" title={item.screenshotError}>Screenshot failed</span>
				{/if}
			</svelte:element>
			{#if !readonly}
				<div class="failed-actions">
					<button
						class="retry-button"
						title="Retry screenshot"
						onclick={() => mutate(api.screenshots.reimageItem, { itemId: item._id })}
					>
						retry
					</button>
					<button class="delete-button" title="Delete item" onclick={() => deleteItem(item._id)}>
						delete
					</button>
				</div>
			{/if}
		</div>
	{:else}
		<svelte:element this={href ? 'a' : 'div'} {href} class="card-link">
			{#if shouldDisplayAsImage(item)}
				<img
					src={item.imageUrl}
					alt={item.title ?? item.url ?? 'image'}
					width={item.imageWidth}
					height={item.imageHeight}
					decoding="async"
					loading="lazy"
				/>
			{:else if item.type === 'url'}
				{#if isBusy(item.screenshotStatus)}
					<div class="url-card url-loading">
						<div class="loading-icon">
							<IconSchedule />
						</div>
						<span class="url-text">{item.url}</span>
					</div>
				{:else}
					<div class="url-card">
						<span class="url-text">{item.url}</span>
					</div>
				{/if}
			{:else if item.type === 'text'}
				<div class="text-card">
					<p>{item.content}</p>
				</div>
			{/if}
		</svelte:element>
	{/if}
	{#if showTitles && item.title}
		<div class="card-title">{item.title}</div>
	{/if}
{/snippet}

<div class="masonry" bind:this={containerElement} bind:clientWidth={containerWidth}>
	{#each displayColumns as column, colIndex (colIndex)}
		<div class="column">
			{#each column as item (item._id)}
				{#if item._id === 'placeholder'}
					<div class="placeholder" style:height="{(item as { height: number }).height}px"></div>
				{:else}
					{@const realItem = item as DisplayItem}
					<!-- A mouse or pen drags the whole card; the keyboard reaches its link and buttons -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						class="clickable card"
						class:titled={showTitles}
						class:dragging={draggedItem?._id === realItem._id}
						onpointerdown={isDraggable ? (e) => handlePointerDown(realItem, e) : undefined}
					>
						{@render cardContent(realItem, getItemUrl(realItem._id))}
					</div>
				{/if}
			{/each}
		</div>
	{/each}
</div>

{#if draggedItem}
	<div
		class="drag-preview"
		style:transform="translate3d({previewPosition.x}px, {previewPosition.y}px, 0) rotate(2deg)"
		style:width="{columnWidth}px"
	>
		<div class="clickable card" class:titled={showTitles}>
			{@render cardContent(draggedItem)}
		</div>
	</div>
{/if}

<style>
	.masonry {
		display: flex;
		gap: var(--gutter);
		width: 100%;
		padding-bottom: var(--space-2xl);
	}

	.column {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: var(--gutter);
		min-width: 0;
	}

	.card {
		position: relative;
		padding: var(--card-pad);
	}

	.card.dragging {
		opacity: 0;
		pointer-events: none;
	}

	.card.titled {
		padding-bottom: var(--space-xs);
	}

	.card img {
		width: 100%;
		display: block;
		height: auto;
	}

	.text-card {
		padding: var(--card-pad);
		background: var(--bg-2);
		overflow-wrap: break-word;
		overflow: auto;
	}

	.text-card p {
		max-height: calc(1.5rem * 10 - 0.125rem);
		margin: 0;
		white-space: pre-wrap;
	}

	.url-text {
		color: var(--txt-3);
	}

	/* Loading state for URL items */
	.url-loading {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--gap);
		aspect-ratio: 1440 / 900;
		justify-content: center;
	}

	.loading-icon,
	.failed-icon {
		width: 2rem;
		height: 2rem;
	}

	.loading-icon {
		color: var(--bg-3);
		animation: pulse 2s ease-in-out infinite;
	}

	.failed-icon {
		color: var(--txt-3);
	}

	.loading-icon :global(svg),
	.failed-icon :global(svg) {
		width: 100%;
		height: 100%;
	}

	/* Failed state for URL items */
	.url-failed {
		display: flex;
		flex-direction: column;
		gap: var(--gap);
		aspect-ratio: 1440 / 900;
	}

	.failed-content {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--gap);
		flex: 1;
		justify-content: center;
	}

	.failed-actions {
		display: flex;
		gap: var(--gap);
	}

	/* Above the link's stretched ::after: the buttons, and the link's own content,
	   so a long note still scrolls and an image keeps its context menu */
	.card-link > *,
	.failed-actions {
		position: relative;
		z-index: 1;
	}

	.retry-button,
	.delete-button {
		flex: 1;
		padding: var(--pad-y-sm) var(--pad-x-sm);
		font-size: var(--text-sm);
	}

	.card-title {
		padding-top: var(--space-xs);
		font-size: var(--text-sm);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.placeholder {
		border: 2px dashed var(--border);
		background: var(--bg-2);
		opacity: 0.5;
	}

	.drag-preview {
		position: fixed;
		top: 0;
		left: 0;
		pointer-events: none;
		z-index: 1000;
		opacity: 0.9;
		will-change: transform;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
	}

	.drag-preview .card {
		background: var(--bg-1);
	}

	@media (max-width: 768px) {
		.masonry {
			padding-bottom: var(--toolbar-clearance);
		}
	}
</style>
