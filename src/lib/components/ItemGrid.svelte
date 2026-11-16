<script lang="ts">
	import { generateKeyBetween } from 'fractional-indexing';
	import { prepare, layout, type PreparedText } from '@chenglou/pretext';
	import { onDestroy, tick, untrack } from 'svelte';
	import { prefersReducedMotion } from 'svelte/motion';
	import { fade } from 'svelte/transition';
	import { api } from '../../convex/_generated/api.js';
	import type { Id } from '../../convex/_generated/dataModel.js';
	import { useDeleteItem, useMutation } from '#lib/convex.js';
	import { pointerDrag } from '#lib/pointerDrag.js';
	import { shouldDisplayAsImage, getItemUrl, isBusy } from '#lib/itemDisplay.js';
	import {
		GAP,
		columnCountFor,
		columnWidthFor,
		fillColumns,
		nearestColumn,
		nearestSlot,
		gapOf,
		type Fill
	} from '#lib/masonry.js';
	import { spring } from '#lib/spring.js';
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

	// ============ LAYOUT ============
	// Cards are placed by their measured height (one observer for all of them); a card
	// not measured yet, as on its first render, is placed by its estimate
	let measured = $state.raw(new Map<string, number>());
	let observer: ResizeObserver | undefined;

	function measure(card: HTMLElement) {
		observer ??= new ResizeObserver((entries) => {
			const next = new Map(measured);
			for (const { target, borderBoxSize } of entries) {
				next.set((target as HTMLElement).dataset.id!, borderBoxSize[0].blockSize);
			}
			measured = next;
		});
		// Border box: toggling titles changes only a card's padding
		observer.observe(card, { box: 'border-box' });
		return () => observer?.unobserve(card);
	}

	const heightOf = (item: DisplayItem) => measured.get(item._id) ?? estimateHeight(item);

	type Position = { x: number; y: number };
	type Layout = { fill: Fill; positions: Map<string, Position> };
	const PLACEHOLDER = 'placeholder';

	function arrange(ids: string[], heights: number[]): Layout {
		const fill = fillColumns(heights, columnCount, gap);
		const positions = new Map(
			ids.map((id, i) => [id, { x: fill.columns[i] * (columnWidth + gap), y: fill.tops[i] }])
		);
		return { fill, positions };
	}

	const normal = $derived(
		arrange(
			items.map((item) => item._id),
			items.map(heightOf)
		)
	);

	// ============ DRAG ============
	let draggedItem: DisplayItem | null = $state(null);
	let previewPosition = $state({ x: 0, y: 0 });
	// The layout with a placeholder at the drop target (null when the target is unreachable)
	let simulation = $state.raw<ReturnType<typeof simulate>>(null);
	let cancelDrag: (() => void) | null = null;

	// Taken at drag start: the layout doesn't change mid-drag, so heights and slot
	// boundaries are computed once instead of on every move
	let drag: {
		offset: Position; // pointer position within the card
		others: DisplayItem[]; // item order without the dragged item
		heights: number[]; // parallel to others
		height: number; // the dragged item's, for the placeholder
		fill: Fill; // where others go without the placeholder
		target: { col: number; slot: number };
	} | null = null;

	const shown = $derived(simulation ?? normal);

	// ============ MOTION ============
	// Cards glide to new places and fade in and out; the dragged card lifts, swings with
	// the pointer's sideways speed and glides into its slot. Nothing moves when the
	// system asks for reduced motion.
	const GLIDE = { duration: 210, easing: 'cubic-bezier(0.2, 0, 0, 1)' }; // also .placeholder's
	const SWING = spring(900, 39); // the tilt's transition, settling with a little overshoot
	const LIFT_SCALE = 1.04; // .lifted's scale
	const TILT = 2; // degrees, at rest

	const calm = $derived(prefersReducedMotion.current);

	// Cards take their places without moving until the grid has painted, and while its
	// width changes: two frames, for the change and then the heights measured at it
	let still = $state(true);
	$effect.pre(() => {
		void containerWidth;
		still = true;
		let frame = requestAnimationFrame(() => {
			frame = requestAnimationFrame(() => (still = false));
		});
		return () => cancelAnimationFrame(frame);
	});

	// Each card glides from where it was shown to where it's now placed: an animation
	// rather than a CSS transition, which a reorder (moving card nodes) would drop. One
	// already gliding sets off again from where it has got to, or stops there and jumps
	// when the grid holds still.
	let placed = new Map<string, string>();
	$effect(() => {
		void shown;
		untrack(() => {
			const glide = !still && !calm;
			const next = new Map<string, string>();
			for (const card of containerElement?.querySelectorAll<HTMLElement>(':scope > .card') ?? []) {
				const id = card.dataset.id!;
				const to = card.style.translate;
				const from = placed.get(id);
				next.set(id, to);
				if (from === to) continue;
				const gliding = card.getAnimations().find((a) => a.id === 'glide');
				const start = gliding ? getComputedStyle(card).translate : from;
				gliding?.cancel();
				if (glide && start && id !== landing) {
					card.animate([{ translate: start }, { translate: to }], { ...GLIDE, id: 'glide' });
				}
			}
			placed = next;
		});
	});

	// A card added after the first paint fades in (one arriving mid-drag stays hidden)
	function enter(card: HTMLElement) {
		if (untrack(() => still || calm || draggedItem)) return;
		card.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 170, easing: 'ease-out' });
	}

	let tilt = $state(0);
	let grabPoint = $state('50% 50%'); // the pointer's place on the card, which it grows and swings around
	let lastMove = { x: 0, t: 0 };
	let rightTimer: ReturnType<typeof setTimeout> | undefined;

	// The tilt follows the pointer's sideways speed, and rights itself once it stops
	function swing(x: number) {
		const now = performance.now();
		const dt = now - lastMove.t;
		if (dt > 0 && dt < 100) {
			const velocity = (x - lastMove.x) / dt; // px per ms
			tilt = Math.max(-14, Math.min(14, tilt * 0.6 + velocity * 3));
		}
		lastMove = { x, t: now };
		clearTimeout(rightTimer);
		rightTimer = setTimeout(() => (tilt = 0), 90);
	}

	function pickUp(card: HTMLElement) {
		if (untrack(() => calm)) return;
		card.animate(
			[{ offset: 0, scale: '1', rotate: '0deg', boxShadow: '0 0 0 transparent' }],
			GLIDE
		);
	}

	// Mid-flight from where it was let go, a dropped card isn't moved by the layout
	let landing = $state<string | null>(null);

	async function land(id: string, from: Keyframe) {
		landing = id;
		await tick();
		const card = containerElement?.querySelector<HTMLElement>(`.card[data-id="${id}"]`);
		if (!card || calm) {
			requestAnimationFrame(() => requestAnimationFrame(() => landing === id && (landing = null)));
			return;
		}
		const to = {
			translate: card.style.translate,
			rotate: '0deg',
			scale: '1',
			transformOrigin: from.transformOrigin
		};
		card.animate([from, to], GLIDE).finished.then(
			() => landing === id && (landing = null),
			() => {}
		);
	}

	// The placeholder goes in just before the card that would otherwise fill that slot,
	// or after the last card when the fill ends on that column
	function simulate(col: number, slot: number) {
		if (!drag) return null;
		const { others, heights, height, fill } = drag;
		let seen = 0;
		let index = fill.columns.findIndex((c) => c === col && seen++ === slot);
		if (index === -1 && seen === slot && fill.next === col) index = others.length;
		if (index === -1) return null;

		const layout = arrange(
			others.map((item) => item._id as string).toSpliced(index, 0, PLACEHOLDER),
			heights.toSpliced(index, 0, height)
		);
		return {
			...layout,
			placeholder: { ...layout.positions.get(PLACEHOLDER)!, height },
			before: others[index - 1] ?? null,
			after: others[index] ?? null
		};
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
		const heights = items.map(heightOf);
		const index = items.findIndex((i) => i._id === item._id);
		const { columns } = normal.fill;
		const col = columns[index];
		const slot = columns.slice(0, index).filter((c) => c === col).length;

		const othersHeights = heights.toSpliced(index, 1);
		drag = {
			offset: { x: x - rect.left, y: y - rect.top },
			others: items.toSpliced(index, 1),
			heights: othersHeights,
			height: heights[index],
			fill: fillColumns(othersHeights, columnCount, gap),
			target: { col, slot }
		};
		draggedItem = item;
		previewPosition = { x: rect.left, y: rect.top };
		simulation = simulate(col, slot);
		tilt = 0;
		lastMove = { x, t: performance.now() };
		grabPoint = `${drag.offset.x}px ${drag.offset.y}px`;
	}

	// Also runs when the page scrolls under a still pointer, so the target follows the content
	function handleDragMove(x: number, y: number) {
		if (!drag || !containerElement) return;
		previewPosition = { x: x - drag.offset.x, y: y - drag.offset.y };
		if (!calm) swing(x);

		// The target follows the dragged card, wherever it was grabbed: the slot nearest its
		// top edge, in the column nearest its left edge
		const container = containerElement.getBoundingClientRect();
		const col = nearestColumn(previewPosition.x - container.left, columnWidth, columnCount, gap);
		const slot = nearestSlot(drag.fill, drag.heights, col, previewPosition.y - container.top, gap);

		// Most moves stay over the same slot; only re-run the layout when the target changes
		if (col === drag.target.col && slot === drag.target.slot) return;
		drag.target = { col, slot };
		simulation = simulate(col, slot);
	}

	function handleDragEnd(commit: boolean) {
		const dragged = draggedItem;
		const drop = simulation;
		if (dragged && containerElement) {
			// Where the preview is, in the grid's coordinates
			const grid = containerElement.getBoundingClientRect();
			land(dragged._id, {
				translate: `${previewPosition.x - grid.left}px ${previewPosition.y - grid.top}px`,
				rotate: `${TILT + tilt}deg`,
				scale: `${LIFT_SCALE}`,
				transformOrigin: grabPoint
			});
		}
		clearTimeout(rightTimer);
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
	onDestroy(() => {
		cancelDrag?.();
		clearTimeout(rightTimer);
		observer?.disconnect();
	});
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

<!-- One list in item order, so tab and reading order follow it, each card placed by
	its translate: a card that changes column moves rather than remounting. Nothing
	renders until the width is known, which the client has before its first paint. -->
<div
	class="masonry"
	bind:this={containerElement}
	bind:clientWidth={containerWidth}
	style:height="{containerWidth && shown.fill.height}px"
>
	{#if containerWidth}
		{#each items as item (item._id)}
			{@const position = shown.positions.get(item._id)}
			{@const place = position ?? normal.positions.get(item._id)!}
			<!-- A mouse or pen drags the whole card; the keyboard reaches its link and buttons.
				Mid-drag, the dragged card is hidden, as is one that arrives (it has no place),
				each kept where it is outside the drag so it doesn't glide in from elsewhere. -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class={[
					'clickable card',
					{
						titled: showTitles,
						hidden: !position || draggedItem?._id === item._id,
						landing: landing === item._id
					}
				]}
				data-id={item._id}
				style:width="{columnWidth}px"
				style:translate="{place.x}px {place.y}px"
				onpointerdown={isDraggable ? (e) => handlePointerDown(item, e) : undefined}
				{@attach measure}
				{@attach enter}
				out:fade={{ duration: still || calm ? 0 : 130 }}
			>
				{@render cardContent(item, getItemUrl(item._id))}
			</div>
		{/each}
		{#if simulation}
			<div
				class="placeholder"
				style:width="{columnWidth}px"
				style:height="{simulation.placeholder.height}px"
				style:translate="{simulation.placeholder.x}px {simulation.placeholder.y}px"
			></div>
		{/if}
	{/if}
</div>

{#if draggedItem}
	<div
		class="drag-preview"
		style:translate="{previewPosition.x}px {previewPosition.y}px"
		style:width="{columnWidth}px"
	>
		<div
			class={['clickable card', { titled: showTitles, lifted: !calm }]}
			style:rotate="{TILT + tilt}deg"
			style:transform-origin={calm ? undefined : grabPoint}
			style:--swing="{SWING.duration}ms {SWING.easing}"
			{@attach pickUp}
		>
			{@render cardContent(draggedItem)}
		</div>
	</div>
{/if}

<style>
	/* The gap is only read (gapOf) for the layout; the height is set inline, and the
	   padding below it is extra */
	.masonry {
		position: relative;
		box-sizing: content-box;
		width: 100%;
		gap: var(--gutter);
		padding-bottom: var(--space-2xl);
	}

	.card {
		position: relative;
		padding: var(--card-pad);
	}

	.masonry > .card,
	.placeholder {
		position: absolute;
		top: 0;
		left: 0;
	}

	.card.landing {
		z-index: 1;
	}

	.card.hidden {
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
		transition: translate 210ms cubic-bezier(0.2, 0, 0, 1);
	}

	@media (prefers-reduced-motion: reduce) {
		.placeholder {
			transition: none;
		}
	}

	.drag-preview {
		position: fixed;
		top: 0;
		left: 0;
		pointer-events: none;
		z-index: 1000;
		opacity: 0.9;
		will-change: translate;
	}

	.drag-preview .card {
		background: var(--bg-1);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
	}

	.drag-preview .card.lifted {
		scale: 1.04;
		box-shadow: 0 16px 40px rgba(0, 0, 0, 0.3);
		transition: rotate var(--swing);
	}

	@media (max-width: 768px) {
		.masonry {
			padding-bottom: var(--toolbar-clearance);
		}
	}
</style>
