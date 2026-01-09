<script lang="ts">
	import { SvelteMap } from 'svelte/reactivity';
	import { generateKeyBetween } from 'fractional-indexing';
	import type { Id } from '../../convex/_generated/dataModel.js';

	interface Item {
		_id: Id<'items'>;
		type: 'url' | 'text' | 'image';
		title?: string;
		url?: string;
		content?: string;
		imageUrl?: string | null;
		imageWidth?: number;
		imageHeight?: number;
		position?: string;
	}

	interface Props {
		items: Item[];
		collectionId?: Id<'collections'>;
		onReorder?: (itemId: Id<'items'>, newPosition: string) => void;
	}

	let { items, collectionId, onReorder }: Props = $props();

	const isDraggable = $derived(!!collectionId && !!onReorder);

	let containerElement: HTMLDivElement | undefined = $state();
	let containerWidth = $state(0);
	let urlCache = new SvelteMap<Id<'items'>, string>();

	$effect(() => {
		const currentIds = new Set(items.map((i) => i._id));
		for (const id of urlCache.keys()) {
			if (!currentIds.has(id)) urlCache.delete(id);
		}
		for (const item of items) {
			if (item.type === 'image' && item.imageUrl && !urlCache.has(item._id)) {
				urlCache.set(item._id, item.imageUrl);
			}
		}
	});

	// Layout constants
	const GAP = 16;
	const MIN_COL_WIDTH = 320;
	const MAX_COLS = 6;
	const MIN_COLS = 1;
	const CARD_PADDING = 16;
	const CARD_BORDER = 2;
	const CARD_CHROME = CARD_PADDING + CARD_BORDER;
	const TITLE_HEIGHT = 25;
	const IMAGE_FALLBACK_ASPECT = 0.75;
	const TEXT_CARD_PADDING = 16;
	const TEXT_LINE_HEIGHT = 24;
	const TEXT_MAX_LINES = 10;
	const TEXT_CHAR_WIDTH = 7;
	const DEFAULT_HEIGHT = 100;

	let columnCount = $derived(
		containerWidth === 0
			? MIN_COLS
			: Math.min(
					MAX_COLS,
					Math.max(MIN_COLS, Math.floor((containerWidth + GAP) / (MIN_COL_WIDTH + GAP)))
				)
	);

	let columnWidth = $derived(
		columnCount <= MIN_COLS
			? containerWidth
			: (containerWidth - (columnCount - MIN_COLS) * GAP) / columnCount
	);

	function getItemHeight(item: Item): number {
		const titleHeight = item.title ? TITLE_HEIGHT : 0;

		if (item.type === 'image') {
			if (item.imageWidth && item.imageHeight) {
				const imageHeight = columnWidth * (item.imageHeight / item.imageWidth);
				return imageHeight + CARD_CHROME + titleHeight;
			}
			return columnWidth * IMAGE_FALLBACK_ASPECT + CARD_CHROME + titleHeight;
		}

		if (item.type === 'url' || item.type === 'text') {
			const content = item.type === 'url' ? (item.url ?? '') : (item.content ?? '');
			const lines = content.split('\n');
			let totalLines = 0;
			const charsPerLine = Math.max(MIN_COLS, Math.floor(columnWidth / TEXT_CHAR_WIDTH));

			for (const line of lines) {
				if (line.length === 0) {
					totalLines += 1;
				} else {
					totalLines += Math.ceil(line.length / charsPerLine);
				}
			}

			const displayLines = Math.min(totalLines, TEXT_MAX_LINES);
			const textHeight = displayLines * TEXT_LINE_HEIGHT + TEXT_CARD_PADDING;
			return textHeight + CARD_CHROME + titleHeight;
		}

		return DEFAULT_HEIGHT + titleHeight;
	}

	// ============ DRAG STATE ============
	let draggedItem: Item | null = $state(null);
	let draggedItemHeight = $state(0);
	let dragPosition = $state({ x: 0, y: 0 });
	let dragOffset = $state({ x: 0, y: 0 });

	// The frozen column layout when drag started (items stay in these positions)
	let frozenColumns: Item[][] | null = $state(null);

	// Where the placeholder currently is: {colIndex, indexInColumn}
	let placeholderPosition: { colIndex: number; index: number } | null = $state(null);

	// Original position of the dragged item (to detect no-op drops)
	let originalPosition: { colIndex: number; index: number } | null = $state(null);

	// ============ MASONRY DISTRIBUTION ============
	function distributeToColumns(itemsToDistribute: Item[]): Item[][] {
		if (columnCount === 0 || itemsToDistribute.length === 0 || columnWidth === 0) return [];
		const cols: Item[][] = Array.from({ length: columnCount }, () => []);
		const heights = Array(columnCount).fill(0);
		for (const item of itemsToDistribute) {
			const shortest = heights.indexOf(Math.min(...heights));
			cols[shortest].push(item);
			heights[shortest] += getItemHeight(item) + GAP;
		}
		return cols;
	}

	// Normal layout when not dragging
	let normalColumns = $derived(distributeToColumns(items));

	// ============ SLOT CALCULATION ============
	interface Slot {
		colIndex: number;
		index: number; // Index in that column where placeholder would go
		y: number;
		centerY: number;
	}

	function calculateSlots(columns: Item[][], draggedId: Id<'items'>, draggedHeight: number): Slot[] {
		const slots: Slot[] = [];

		for (let colIndex = 0; colIndex < columns.length; colIndex++) {
			const column = columns[colIndex];
			let y = 0;

			// Slot at top of column (index 0)
			slots.push({
				colIndex,
				index: 0,
				y: 0,
				centerY: draggedHeight / 2
			});

			for (let i = 0; i < column.length; i++) {
				const item = column[i];
				// Skip the dragged item when calculating positions
				if (item._id === draggedId) continue;

				y += getItemHeight(item) + GAP;

				// Slot after this item
				slots.push({
					colIndex,
					index: i + 1,
					y,
					centerY: y + draggedHeight / 2
				});
			}
		}

		return slots;
	}

	function findNearestSlot(
		slots: Slot[],
		cursorX: number,
		cursorY: number,
		containerRect: DOMRect
	): Slot | null {
		if (slots.length === 0) return null;

		let nearest: Slot | null = null;
		let nearestDist = Infinity;

		const relativeX = cursorX - containerRect.left;
		const relativeY = cursorY - containerRect.top;

		for (const slot of slots) {
			const slotCenterX = slot.colIndex * (columnWidth + GAP) + columnWidth / 2;
			const dx = relativeX - slotCenterX;
			const dy = relativeY - slot.centerY;
			const dist = Math.sqrt(dx * dx + dy * dy);

			if (dist < nearestDist) {
				nearestDist = dist;
				nearest = slot;
			}
		}

		return nearest;
	}

	// ============ DISPLAY LAYOUT ============
	// Build the layout to display: either normal, or frozen with placeholder
	type DisplayItem = Item | { _id: 'placeholder'; height: number };

	let displayColumns = $derived.by((): DisplayItem[][] => {
		// Not dragging - use normal layout
		if (!frozenColumns || !placeholderPosition || !draggedItem) {
			return normalColumns;
		}

		// Dragging - build layout from frozen columns with placeholder
		const result: DisplayItem[][] = [];

		for (let colIndex = 0; colIndex < frozenColumns.length; colIndex++) {
			const sourceColumn = frozenColumns[colIndex];
			const destColumn: DisplayItem[] = [];

			// Filter out the dragged item from this column
			const itemsWithoutDragged = sourceColumn.filter((item) => item._id !== draggedItem!._id);

			// If this is the column where placeholder goes, insert it
			if (colIndex === placeholderPosition.colIndex) {
				const insertAt = Math.min(placeholderPosition.index, itemsWithoutDragged.length);
				for (let i = 0; i < itemsWithoutDragged.length; i++) {
					if (i === insertAt) {
						destColumn.push({ _id: 'placeholder', height: draggedItemHeight });
					}
					destColumn.push(itemsWithoutDragged[i]);
				}
				// If inserting at the end
				if (insertAt >= itemsWithoutDragged.length) {
					destColumn.push({ _id: 'placeholder', height: draggedItemHeight });
				}
			} else {
				destColumn.push(...itemsWithoutDragged);
			}

			result.push(destColumn);
		}

		return result;
	});

	// ============ DRAG HANDLERS ============
	function handleDragStart(item: Item, e: PointerEvent) {
		if (!isDraggable) return;
		e.preventDefault();

		const target = e.currentTarget as HTMLElement;
		const rect = target.getBoundingClientRect();

		draggedItem = item;
		draggedItemHeight = getItemHeight(item);
		dragOffset = { x: e.clientX - rect.left, y: e.clientY - rect.top };
		dragPosition = { x: e.clientX, y: e.clientY };

		// Freeze the current layout
		frozenColumns = normalColumns.map((col) => [...col]);

		// Find where the item currently is and set initial placeholder there
		for (let colIndex = 0; colIndex < frozenColumns.length; colIndex++) {
			const index = frozenColumns[colIndex].findIndex((i) => i._id === item._id);
			if (index !== -1) {
				placeholderPosition = { colIndex, index };
				originalPosition = { colIndex, index };
				break;
			}
		}

		document.addEventListener('pointermove', handleDragMove);
		document.addEventListener('pointerup', handleDragEnd);
		document.body.style.cursor = 'grabbing';
		document.body.style.userSelect = 'none';
	}

	function handleDragMove(e: PointerEvent) {
		if (!draggedItem || !containerElement || !frozenColumns) return;

		dragPosition = { x: e.clientX, y: e.clientY };

		const containerRect = containerElement.getBoundingClientRect();
		const slots = calculateSlots(frozenColumns, draggedItem._id, draggedItemHeight);
		const nearest = findNearestSlot(slots, e.clientX, e.clientY, containerRect);

		if (nearest) {
			placeholderPosition = { colIndex: nearest.colIndex, index: nearest.index };
		}
	}

	function handleDragEnd() {
		if (!draggedItem || !placeholderPosition || !onReorder || !frozenColumns || !originalPosition) {
			cleanup();
			return;
		}

		// Check if position actually changed
		const samePosition =
			placeholderPosition.colIndex === originalPosition.colIndex &&
			placeholderPosition.index === originalPosition.index;

		if (samePosition) {
			// No change - just cleanup
			cleanup();
			return;
		}

		// Find neighbors in the display layout to calculate new position
		const targetColumn = displayColumns[placeholderPosition.colIndex];

		let beforeItem: Item | null = null;
		let afterItem: Item | null = null;

		// Find placeholder index in the display column
		const placeholderIdx = targetColumn.findIndex((item) => item._id === 'placeholder');

		if (placeholderIdx > 0) {
			const before = targetColumn[placeholderIdx - 1];
			if (before._id !== 'placeholder') beforeItem = before as Item;
		}
		if (placeholderIdx < targetColumn.length - 1) {
			const after = targetColumn[placeholderIdx + 1];
			if (after._id !== 'placeholder') afterItem = after as Item;
		}

		const beforePos = beforeItem?.position ?? null;
		const afterPos = afterItem?.position ?? null;
		const newPosition = generateKeyBetween(beforePos, afterPos);

		const itemId = draggedItem._id;
		cleanup();

		onReorder(itemId, newPosition);
	}

	function cleanup() {
		draggedItem = null;
		frozenColumns = null;
		placeholderPosition = null;
		originalPosition = null;
		draggedItemHeight = 0;
		document.removeEventListener('pointermove', handleDragMove);
		document.removeEventListener('pointerup', handleDragEnd);
		document.body.style.cursor = '';
		document.body.style.userSelect = '';
	}

	$effect(() => {
		if (!containerElement) return;
		const observer = new ResizeObserver((entries) => {
			containerWidth = entries[0].contentRect.width;
		});
		observer.observe(containerElement);
		return () => observer.disconnect();
	});
</script>

<div class="masonry" bind:this={containerElement}>
	{#each displayColumns as column, colIndex (colIndex)}
		<div class="column">
			{#each column as item (item._id)}
				{#if item._id === 'placeholder'}
					<div class="placeholder" style:height="{(item as {height: number}).height}px"></div>
				{:else}
					{@const realItem = item as Item}
					{@const isDragging = draggedItem?._id === realItem._id}
					<div class="card-wrapper" class:dragging={isDragging}>
						<a href="?item={realItem._id}" class="card">
							{#if realItem.type === 'image' && realItem.imageUrl}
								<img
									src={urlCache.get(realItem._id) ?? realItem.imageUrl}
									alt={realItem.title ?? 'Image'}
									width={realItem.imageWidth}
									height={realItem.imageHeight}
									decoding="async"
								/>
							{:else if realItem.type === 'url'}
								<div class="url-card">
									<span class="url-text">{realItem.url}</span>
								</div>
							{:else if realItem.type === 'text'}
								<div class="text-card">
									<p>{realItem.content}</p>
								</div>
							{/if}
							{#if realItem.title}
								<div class="card-title">{realItem.title}</div>
							{/if}
						</a>
						{#if isDraggable}
							<button
								class="drag-handle"
								title="Drag to reorder"
								onpointerdown={(e) => handleDragStart(realItem, e)}
							>⠿</button>
						{/if}
					</div>
				{/if}
			{/each}
		</div>
	{/each}
</div>

{#if draggedItem}
	<div
		class="drag-preview"
		style:left="{dragPosition.x - dragOffset.x}px"
		style:top="{dragPosition.y - dragOffset.y}px"
		style:width="{columnWidth}px"
	>
		<div class="card">
			{#if draggedItem.type === 'image' && draggedItem.imageUrl}
				<img
					src={urlCache.get(draggedItem._id) ?? draggedItem.imageUrl}
					alt={draggedItem.title ?? 'Image'}
					width={draggedItem.imageWidth}
					height={draggedItem.imageHeight}
					decoding="async"
				/>
			{:else if draggedItem.type === 'url'}
				<div class="url-card">
					<span class="url-text">{draggedItem.url}</span>
				</div>
			{:else if draggedItem.type === 'text'}
				<div class="text-card">
					<p>{draggedItem.content}</p>
				</div>
			{/if}
			{#if draggedItem.title}
				<div class="card-title">{draggedItem.title}</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	.masonry {
		display: flex;
		gap: 1rem;
		width: 100%;
	}

	.column {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		min-width: 0;
	}

	.card-wrapper {
		position: relative;
	}

	.card-wrapper.dragging {
		opacity: 0;
		pointer-events: none;
	}

	.card {
		border: 1px solid var(--border);
		padding: 0.5rem;
		display: block;
		text-decoration: none;
		color: inherit;
	}

	.card:hover {
		border-color: var(--txt-2);
	}

	.card img {
		width: 100%;
		display: block;
		height: auto;
	}

	.url-card,
	.text-card {
		padding: 0.5rem;
		background: var(--bg-2);
		word-break: break-all;
	}

	.text-card {
		overflow: auto;
		scrollbar-width: thin;
		scrollbar-color: var(--bg-3) transparent;
	}

	.text-card p {
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 10;
		margin: 0;
		white-space: pre-wrap;
	}

	.url-text {
		color: var(--txt-2);
	}

	.card-title {
		padding: 0.25rem 0 0 0;
		font-size: 0.875rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.drag-handle {
		position: absolute;
		top: 0.25rem;
		left: 0.25rem;
		padding: 0.25rem;
		cursor: grab;
		opacity: 0;
		transition: opacity 0.15s;
		background: var(--bg-1);
		border: 1px solid var(--border);
		font-size: 1rem;
		line-height: 1;
		color: var(--txt-3);
	}

	.card-wrapper:hover .drag-handle {
		opacity: 1;
	}

	.drag-handle:active {
		cursor: grabbing;
	}

	.placeholder {
		border: 2px dashed var(--txt-3);
		border-radius: 4px;
		background: var(--bg-2);
		opacity: 0.5;
	}

	.drag-preview {
		position: fixed;
		pointer-events: none;
		z-index: 1000;
		opacity: 0.9;
		transform: rotate(2deg);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
	}

	.drag-preview .card {
		background: var(--bg-1);
	}
</style>
