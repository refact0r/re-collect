<script lang="ts">
	import { SvelteMap } from 'svelte/reactivity';
	import { generateKeyBetween } from 'fractional-indexing';
	import { page } from '$app/state';
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
		// Screenshot fields for URL items
		screenshotStatus?: 'pending' | 'processing' | 'completed' | 'failed';
		screenshotError?: string;
	}

	interface Props {
		items: Item[];
		collectionId?: Id<'collections'>;
		onReorder?: (itemId: Id<'items'>, newPosition: string) => void;
		onRetryScreenshot?: (itemId: Id<'items'>) => void;
	}

	let { items, collectionId, onReorder, onRetryScreenshot }: Props = $props();

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
			// Cache image URLs for image items and URL items with completed screenshots
			const hasImage =
				(item.type === 'image' || (item.type === 'url' && item.screenshotStatus === 'completed')) &&
				item.imageUrl;
			if (hasImage && !urlCache.has(item._id)) {
				urlCache.set(item._id, item.imageUrl!);
			}
		}
	});

	// Layout constants
	const GAP = 16;
	const MIN_COL_WIDTH = 320;
	const MAX_COLS = 6;
	const MIN_COLS = 1;
	// Card has padding: 0.5rem (8px) on each side = 16px total, border: 1px on each side = 2px total
	const CARD_PADDING = 16; // 8px * 2
	const CARD_BORDER = 2; // 1px * 2
	const CARD_CHROME = CARD_PADDING + CARD_BORDER; // 18px total vertical chrome
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

	function estimateHeight(item: Item): number {
		const titleHeight = item.title ? TITLE_HEIGHT : 0;

		if (item.type === 'image') {
			if (item.imageWidth && item.imageHeight) {
				const imageHeight = columnWidth * (item.imageHeight / item.imageWidth);
				return imageHeight + CARD_CHROME + titleHeight;
			}
			return columnWidth * IMAGE_FALLBACK_ASPECT + CARD_CHROME + titleHeight;
		}

		// URL items with completed screenshots display like images
		if (item.type === 'url' && item.screenshotStatus === 'completed') {
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

		return DEFAULT_HEIGHT + CARD_CHROME + titleHeight;
	}

	// ============ MASONRY DISTRIBUTION ============
	function distributeMasonry(itemsToDistribute: Item[]): Item[][] {
		if (columnCount === 0 || itemsToDistribute.length === 0 || columnWidth === 0) return [];
		const cols: Item[][] = Array.from({ length: columnCount }, () => []);
		const heights = Array(columnCount).fill(0);
		for (const item of itemsToDistribute) {
			const shortest = heights.indexOf(Math.min(...heights));
			cols[shortest].push(item);
			heights[shortest] += estimateHeight(item) + GAP;
		}
		return cols;
	}

	// Normal layout when not dragging
	let normalColumns = $derived(distributeMasonry(items));

	// ============ DRAG STATE ============
	let draggedItem: Item | null = $state(null);
	let draggedItemHeight = $state(0); // Actual measured height for display
	let draggedItemEstimatedHeight = $state(0); // Predicted height for algorithm consistency
	let dragPosition = $state({ x: 0, y: 0 });
	let dragOffset = $state({ x: 0, y: 0 });

	// Original flat item order (excluding dragged item) for simulation
	let itemsForSimulation: Item[] = $state([]);

	// The simulated layout during drag (null if current position is invalid)
	type DisplayItem = Item | { _id: 'placeholder'; height: number };
	let simulationResult: {
		columns: DisplayItem[][];
		beforeItem: Item | null;
		afterItem: Item | null;
	} | null = $state(null);

	// ============ MASONRY SIMULATION WITH PLACEHOLDER ============

	/**
	 * Given items and a target position (column + slot), simulate the masonry fill
	 * and try to insert a placeholder at that position.
	 * Returns the resulting columns and flat-list neighbors if valid, or null if unreachable.
	 */
	function distributeMasonryWithPlaceholder(
		itemsToPlace: Item[],
		targetCol: number,
		targetSlot: number,
		placeholderHeight: number
	): { columns: DisplayItem[][]; beforeItem: Item | null; afterItem: Item | null } | null {
		if (columnCount === 0 || columnWidth === 0) return null;

		const cols: DisplayItem[][] = Array.from({ length: columnCount }, () => []);
		const heights = Array(columnCount).fill(0);
		let placeholderPlaced = false;
		let beforeItem: Item | null = null;
		let afterItem: Item | null = null;
		let lastPlacedItem: Item | null = null;

		for (let i = 0; i < itemsToPlace.length; i++) {
			const item = itemsToPlace[i];

			// Find the shortest column
			let shortest = heights.indexOf(Math.min(...heights));

			// Before placing this item, check if we should place placeholder
			if (!placeholderPlaced && shortest === targetCol && cols[targetCol].length === targetSlot) {
				// Place placeholder here
				cols[targetCol].push({ _id: 'placeholder', height: placeholderHeight });
				heights[targetCol] += placeholderHeight + GAP;
				placeholderPlaced = true;

				// Record the flat-order neighbors
				beforeItem = lastPlacedItem;
				afterItem = item; // This item comes after the placeholder

				// Recalculate shortest since we just added placeholder
				shortest = heights.indexOf(Math.min(...heights));
			}

			// Place the item
			cols[shortest].push(item);
			heights[shortest] += estimateHeight(item) + GAP;
			lastPlacedItem = item;
		}

		// After all items, try to place placeholder if not yet placed
		if (!placeholderPlaced) {
			const shortest = heights.indexOf(Math.min(...heights));
			if (shortest === targetCol && cols[targetCol].length === targetSlot) {
				cols[targetCol].push({ _id: 'placeholder', height: placeholderHeight });
				placeholderPlaced = true;
				beforeItem = lastPlacedItem;
				afterItem = null; // Placeholder is at the end
			}
		}

		return placeholderPlaced ? { columns: cols, beforeItem, afterItem } : null;
	}

	/**
	 * Determine which column the cursor is over based on X position
	 */
	function getColumnFromCursorX(cursorX: number, containerRect: DOMRect): number {
		const relativeX = cursorX - containerRect.left;
		const colWidth = columnWidth + GAP;
		const col = Math.floor(relativeX / colWidth);
		return Math.max(0, Math.min(columnCount - 1, col));
	}

	/**
	 * Determine which slot in a column the cursor wants based on Y position.
	 * Uses the original column layout (without placeholder) to calculate slot boundaries.
	 */
	function getSlotFromCursorY(cursorY: number, containerRect: DOMRect, column: Item[]): number {
		const relativeY = cursorY - containerRect.top;
		let y = 0;
		for (let i = 0; i < column.length; i++) {
			const itemHeight = estimateHeight(column[i]);
			const slotMidpoint = y + itemHeight / 2;
			if (relativeY < slotMidpoint) {
				return i;
			}
			y += itemHeight + GAP;
		}
		return column.length;
	}

	/**
	 * Find an item's column and slot in the column layout.
	 */
	function findItemInColumns(
		columns: Item[][],
		itemId: Id<'items'>
	): { colIndex: number; slotIndex: number } | null {
		for (let colIndex = 0; colIndex < columns.length; colIndex++) {
			const slotIndex = columns[colIndex].findIndex((i) => i._id === itemId);
			if (slotIndex !== -1) {
				return { colIndex, slotIndex };
			}
		}
		return null;
	}

	/**
	 * Update the placeholder's display height in a simulation result.
	 */
	function updatePlaceholderHeight(sim: { columns: DisplayItem[][] }, height: number): void {
		for (const col of sim.columns) {
			for (const item of col) {
				if (item._id === 'placeholder') {
					(item as { _id: 'placeholder'; height: number }).height = height;
				}
			}
		}
	}

	// ============ DISPLAY LAYOUT ============
	let displayColumns = $derived.by((): DisplayItem[][] => {
		if (draggedItem && simulationResult) {
			return simulationResult.columns;
		}
		return normalColumns;
	});

	// ============ DRAG HANDLERS ============
	function handleDragStart(item: Item, e: PointerEvent) {
		if (!isDraggable) return;
		e.preventDefault();

		const target = e.currentTarget as HTMLElement;
		// Get the card-wrapper element (the button's parent)
		const cardWrapper = target.closest('.card-wrapper') as HTMLElement;
		const rect = cardWrapper.getBoundingClientRect();

		draggedItem = item;
		// Use actual measured height for display, calculated height for algorithm
		draggedItemHeight = rect.height;
		draggedItemEstimatedHeight = estimateHeight(item);
		dragOffset = { x: e.clientX - rect.left, y: e.clientY - rect.top };
		dragPosition = { x: e.clientX, y: e.clientY };

		// Store items excluding the dragged one for simulation
		itemsForSimulation = items.filter((i) => i._id !== item._id);

		// Find original position and create initial simulation
		const position = findItemInColumns(normalColumns, item._id);
		if (position) {
			const initialSim = distributeMasonryWithPlaceholder(
				itemsForSimulation,
				position.colIndex,
				position.slotIndex,
				draggedItemEstimatedHeight
			);
			if (initialSim) {
				updatePlaceholderHeight(initialSim, draggedItemHeight);
				simulationResult = initialSim;
			}
		}

		document.addEventListener('pointermove', handleDragMove);
		document.addEventListener('pointerup', handleDragEnd);
		document.body.style.cursor = 'grabbing';
		document.body.style.userSelect = 'none';
	}

	function handleDragMove(e: PointerEvent) {
		if (!draggedItem || !containerElement) return;

		dragPosition = { x: e.clientX, y: e.clientY };

		const containerRect = containerElement.getBoundingClientRect();

		// Determine target column from cursor X
		const targetCol = getColumnFromCursorX(e.clientX, containerRect);

		// Use the ORIGINAL layout (normalColumns with dragged item) to determine slot
		// This gives us stable slot positions that match what the user sees
		const originalColumn = normalColumns[targetCol] || [];

		// Determine target slot from cursor Y based on original column layout
		const targetSlot = getSlotFromCursorY(e.clientY, containerRect, originalColumn);

		// Try to simulate with placeholder at this position
		// Use calculated height for algorithm consistency, but the result will display with measured height
		const newSimulation = distributeMasonryWithPlaceholder(
			itemsForSimulation,
			targetCol,
			targetSlot,
			draggedItemEstimatedHeight
		);

		if (newSimulation) {
			updatePlaceholderHeight(newSimulation, draggedItemHeight);
		}

		simulationResult = newSimulation;
	}

	function handleDragEnd() {
		if (!draggedItem || !onReorder) {
			cleanup();
			return;
		}

		// If no valid drop position, just revert
		if (!simulationResult) {
			cleanup();
			return;
		}

		// Use the flat-list neighbors from the simulation result
		const { beforeItem, afterItem } = simulationResult;

		const beforePos = beforeItem?.position ?? null;
		const afterPos = afterItem?.position ?? null;

		// Check if the item's current neighbors are the same as the target neighbors
		// If so, no reorder is needed
		const currentIndex = items.findIndex((i) => i._id === draggedItem!._id);
		const currentBefore = currentIndex > 0 ? items[currentIndex - 1] : null;
		const currentAfter = currentIndex < items.length - 1 ? items[currentIndex + 1] : null;

		const samePosition =
			beforeItem?._id === currentBefore?._id && afterItem?._id === currentAfter?._id;

		if (samePosition) {
			cleanup();
			return;
		}

		// Validate that beforePos < afterPos (required by fractional-indexing)
		if (beforePos !== null && afterPos !== null && beforePos >= afterPos) {
			cleanup();
			return;
		}

		const newPosition = generateKeyBetween(beforePos, afterPos);

		const itemId = draggedItem._id;
		cleanup();

		onReorder(itemId, newPosition);
	}

	function cleanup() {
		draggedItem = null;
		simulationResult = null;
		itemsForSimulation = [];
		draggedItemHeight = 0;
		draggedItemEstimatedHeight = 0;
		document.removeEventListener('pointermove', handleDragMove);
		document.removeEventListener('pointerup', handleDragEnd);
		document.body.style.cursor = '';
		document.body.style.userSelect = '';
	}

	function getItemUrl(itemId: Id<'items'>): string {
		const params = new URLSearchParams(page.url.searchParams);
		params.set('item', itemId);
		return `${page.url.pathname}?${params}`;
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
					<div class="placeholder" style:height="{(item as { height: number }).height}px"></div>
				{:else}
					{@const realItem = item as Item}
					{@const isDragging = draggedItem?._id === realItem._id}
					<div class="card-wrapper" class:dragging={isDragging}>
						<a href={getItemUrl(realItem._id)} class="card">
							{#if realItem.type === 'image' && realItem.imageUrl}
								<img
									src={urlCache.get(realItem._id) ?? realItem.imageUrl}
									alt={realItem.title ?? 'image'}
									width={realItem.imageWidth}
									height={realItem.imageHeight}
									decoding="async"
								/>
							{:else if realItem.type === 'url'}
								{#if realItem.screenshotStatus === 'completed' && realItem.imageUrl}
									<img
										src={urlCache.get(realItem._id) ?? realItem.imageUrl}
										alt={realItem.title ?? realItem.url ?? 'screenshot'}
										width={realItem.imageWidth}
										height={realItem.imageHeight}
										decoding="async"
									/>
								{:else if realItem.screenshotStatus === 'pending' || realItem.screenshotStatus === 'processing'}
									<div class="url-card url-loading">
										<div class="loading-icon">
											<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
												<circle cx="12" cy="12" r="10" />
												<path d="M12 6v6l4 2" />
											</svg>
										</div>
										<span class="url-text">{realItem.url}</span>
									</div>
								{:else if realItem.screenshotStatus === 'failed'}
									<div class="url-card url-failed">
										<div class="failed-content">
											<div class="failed-icon">
												<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
													<circle cx="12" cy="12" r="10" />
													<line x1="12" y1="8" x2="12" y2="12" />
													<line x1="12" y1="16" x2="12.01" y2="16" />
												</svg>
											</div>
											<span class="url-text">{realItem.url}</span>
											{#if realItem.screenshotError}
												<span class="error-text" title={realItem.screenshotError}
													>Screenshot failed</span
												>
											{/if}
										</div>
										{#if onRetryScreenshot}
											<button
												class="retry-button"
												title="Retry screenshot"
												onclick={(e) => {
													e.preventDefault();
													e.stopPropagation();
													onRetryScreenshot(realItem._id);
												}}
											>
												Retry
											</button>
										{/if}
									</div>
								{:else}
									<div class="url-card">
										<span class="url-text">{realItem.url}</span>
									</div>
								{/if}
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
								title="drag to reorder"
								onpointerdown={(e) => handleDragStart(realItem, e)}>⠿</button
							>
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
					alt={draggedItem.title ?? 'image'}
					width={draggedItem.imageWidth}
					height={draggedItem.imageHeight}
					decoding="async"
				/>
			{:else if draggedItem.type === 'url'}
				{#if draggedItem.screenshotStatus === 'completed' && draggedItem.imageUrl}
					<img
						src={urlCache.get(draggedItem._id) ?? draggedItem.imageUrl}
						alt={draggedItem.title ?? draggedItem.url ?? 'screenshot'}
						width={draggedItem.imageWidth}
						height={draggedItem.imageHeight}
						decoding="async"
					/>
				{:else}
					<div class="url-card">
						<span class="url-text">{draggedItem.url}</span>
					</div>
				{/if}
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
		border-color: var(--txt-3);
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
	}

	.text-card p {
		max-height: calc(1.5rem * 10 - 0.125rem);
		margin: 0;
		white-space: pre-wrap;
	}

	.url-text {
		color: var(--txt-2);
	}

	/* Loading state for URL items */
	.url-loading {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		min-height: 120px;
		justify-content: center;
	}

	.loading-icon {
		width: 2rem;
		height: 2rem;
		color: var(--txt-3);
		animation: pulse 2s ease-in-out infinite;
	}

	.loading-icon svg {
		width: 100%;
		height: 100%;
	}

	@keyframes pulse {
		0%,
		100% {
			opacity: 0.4;
		}
		50% {
			opacity: 1;
		}
	}

	/* Failed state for URL items */
	.url-failed {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-height: 120px;
	}

	.failed-content {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		flex: 1;
		justify-content: center;
	}

	.failed-icon {
		width: 2rem;
		height: 2rem;
		color: var(--txt-3);
	}

	.failed-icon svg {
		width: 100%;
		height: 100%;
	}

	.error-text {
		font-size: 0.75rem;
		color: var(--txt-3);
	}

	.retry-button {
		padding: 0.25rem 0.5rem;
		font-size: 0.75rem;
		background: var(--bg-1);
		border: 1px solid var(--border);
		cursor: pointer;
		color: var(--txt-2);
	}

	.retry-button:hover {
		border-color: var(--txt-3);
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
		border: 2px dashed var(--border);
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
