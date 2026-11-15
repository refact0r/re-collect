<script lang="ts">
	import { onMount } from 'svelte';
	import IconAdd from '~icons/material-symbols-light/add-sharp';
	import IconRemove from '~icons/material-symbols-light/remove-sharp';
	import IconFit from '~icons/material-symbols-light/fit-screen-sharp';
	import { api } from '../../../convex/_generated/api.js';
	import { useAction, useQuery } from '#lib/convex.js';
	import { getCollectionsContext } from '#lib/context.js';
	import CollectionFilter from '../CollectionFilter.svelte';
	import { getItemUrl, shouldDisplayAsImage } from '#lib/itemDisplay.js';
	import type { DisplayItem } from '#lib/types.js';

	let { items }: { items: DisplayItem[] } = $props();

	// Thumbnails keep this size at any zoom, so zooming in spreads clusters apart
	const THUMB = 48;
	const MARGIN = THUMB / 2 + 12;
	const MIN_ZOOM = 0.5;
	const MAX_ZOOM = 40;
	const DRAG_THRESHOLD = 4;
	// Past this many points on screen, images give way to palette swatches, so the
	// fitted view of a big library doesn't fetch every full-size image
	const MAX_IMAGES = 400;
	// The filter's "uncollected" option, next to collection ids
	const UNCOLLECTED = 'uncollected';

	interface Placed {
		item: DisplayItem;
		x: number;
		y: number;
		image: { width: number; height: number } | null;
		dim: boolean;
	}

	const mapQuery = useQuery(api.embeddingMap.get, () => ({}));
	const refresh = useAction();
	let updating = $state(false);
	let failed = $state(false);

	// A no-op when nothing changed since the stored layout
	onMount(() => {
		updating = true;
		refresh(api.embeddingMapActions.refresh, {}, { onError: () => (failed = true) }).finally(
			() => (updating = false)
		);
	});

	function imageBox(item: DisplayItem) {
		if (!shouldDisplayAsImage(item)) return null;
		const ratio = item.imageWidth && item.imageHeight ? item.imageWidth / item.imageHeight : 1;
		return ratio >= 1
			? { width: THUMB, height: Math.round(THUMB / ratio) }
			: { width: Math.round(THUMB * ratio), height: THUMB };
	}

	const collections = getCollectionsContext();
	const options = $derived([...(collections.data ?? []).map((c) => c._id), UNCOLLECTED]);
	// The collections picked out on the map; none (or all) shows everything.
	// Other points only dim, so every item keeps its place.
	let picked = $state<Set<string>>(new Set());
	const filtering = $derived(picked.size > 0 && !options.every((id) => picked.has(id)));
	const inFilter = (item: DisplayItem) =>
		item.collections.length > 0
			? item.collections.some((id) => picked.has(id))
			: picked.has(UNCOLLECTED);

	const placed = $derived.by(() => {
		const byId = new Map(items.map((item) => [item._id, item]));
		return (mapQuery.data?.points ?? []).flatMap((p): Placed[] => {
			const item = byId.get(p.itemId);
			if (!item) return [];
			return [{ item, x: p.x, y: p.y, image: imageBox(item), dim: filtering && !inFilter(item) }];
		});
	});
	// What the fitted view frames: the picked-out points, or all of them
	const shown = $derived(placed.filter((p) => !p.dim));
	const framed = $derived(shown.length > 0 ? shown : placed);

	function pick(next: Set<string>) {
		picked = next;
		moved = null;
	}

	const label = (item: DisplayItem) =>
		item.title || item.subject || item.url || item.content?.slice(0, 80) || 'untitled';

	interface View {
		k: number; // screen px per map unit
		x: number; // screen position of the map origin
		y: number;
	}

	let width = $state(0);
	let height = $state(0);

	// The view that shows every framed point; it follows new layouts, resizes and
	// filter changes until the user pans or zooms
	const fitted = $derived.by((): View => {
		if (framed.length === 0 || width === 0) return { k: 1, x: 0, y: 0 };
		const xs = framed.map((p) => p.x);
		const ys = framed.map((p) => p.y);
		const [minX, maxX, minY, maxY] = [
			Math.min(...xs),
			Math.max(...xs),
			Math.min(...ys),
			Math.max(...ys)
		];
		const k = Math.min(
			(width - 2 * MARGIN) / Math.max(maxX - minX, 0.5),
			(height - 2 * MARGIN) / Math.max(maxY - minY, 0.5)
		);
		return { k, x: width / 2 - (k * (minX + maxX)) / 2, y: height / 2 - (k * (minY + maxY)) / 2 };
	});
	let moved = $state<View | null>(null);
	const view = $derived(moved ?? fitted);

	// Only points on screen are drawn
	const visible = $derived(
		placed.filter((p) => {
			const x = view.x + p.x * view.k;
			const y = view.y + p.y * view.k;
			return x > -THUMB && x < width + THUMB && y > -THUMB && y < height + THUMB;
		})
	);
	const showImages = $derived(visible.length <= MAX_IMAGES);

	let dragging = $state(false);
	let hoveredId = $state<string | null>(null);
	const hovered = $derived(placed.find((p) => p.item._id === hoveredId));

	function zoomAt(factor: number, cx: number, cy: number) {
		const k = Math.min(fitted.k * MAX_ZOOM, Math.max(fitted.k * MIN_ZOOM, view.k * factor));
		const f = k / view.k;
		moved = { k, x: cx - (cx - view.x) * f, y: cy - (cy - view.y) * f };
	}

	function panBy(dx: number, dy: number) {
		moved = { ...view, x: view.x + dx, y: view.y + dy };
	}

	function local(e: MouseEvent) {
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		return { x: e.clientX - rect.left, y: e.clientY - rect.top };
	}

	// Svelte's onwheel is passive, and zooming has to stop the page scrolling
	function wheelZoom(el: HTMLElement) {
		const onWheel = (e: WheelEvent) => {
			e.preventDefault();
			const { x, y } = local(e);
			const delta = e.deltaY * (e.deltaMode === 1 ? 16 : 1);
			// a trackpad pinch arrives as ctrl+wheel with small deltas
			zoomAt(Math.exp(-delta * (e.ctrlKey ? 0.01 : 0.002)), x, y);
		};
		el.addEventListener('wheel', onWheel, { passive: false });
		return () => el.removeEventListener('wheel', onWheel);
	}

	// Pressed pointers' last positions; event bookkeeping, nothing renders from it
	const pointers = new Map<number, { x: number; y: number }>();
	let start = { x: 0, y: 0 };
	// Set once a press moves far enough to be a drag, so its click doesn't open an item
	let dragged = false;

	function onpointerdown(e: PointerEvent) {
		if (e.pointerType === 'mouse' && e.button !== 0) return;
		const p = local(e);
		pointers.set(e.pointerId, p);
		if (pointers.size === 1) {
			start = p;
			dragged = false;
		}
	}

	function onpointermove(e: PointerEvent) {
		const prev = pointers.get(e.pointerId);
		if (!prev) return;
		const p = local(e);
		if (!dragged) {
			if (pointers.size < 2 && Math.hypot(p.x - start.x, p.y - start.y) < DRAG_THRESHOLD) return;
			dragged = true;
			dragging = true;
			hoveredId = null;
			const el = e.currentTarget as HTMLElement;
			for (const id of pointers.keys()) el.setPointerCapture(id);
		}
		const other = [...pointers].find(([id]) => id !== e.pointerId)?.[1];
		if (other) {
			// pinch: follow the midpoint, scale by the change in finger spread
			const mid = { x: (p.x + other.x) / 2, y: (p.y + other.y) / 2 };
			const spread = Math.hypot(p.x - other.x, p.y - other.y);
			const spreadBefore = Math.hypot(prev.x - other.x, prev.y - other.y);
			panBy((p.x - prev.x) / 2, (p.y - prev.y) / 2);
			if (spreadBefore > 0) zoomAt(spread / spreadBefore, mid.x, mid.y);
		} else {
			panBy(p.x - prev.x, p.y - prev.y);
		}
		pointers.set(e.pointerId, p);
	}

	function onpointerup(e: PointerEvent) {
		pointers.delete(e.pointerId);
		if (pointers.size === 0) dragging = false;
	}

	// Swallows the one click a drag ends with; a later keyboard click goes through
	function onclickcapture(e: MouseEvent) {
		if (!dragged) return;
		dragged = false;
		e.preventDefault();
		e.stopPropagation();
	}
</script>

<div class="frame">
	<div
		class={['map', { dragging }]}
		bind:clientWidth={width}
		bind:clientHeight={height}
		{@attach wheelZoom}
		{onpointerdown}
		{onpointermove}
		{onpointerup}
		onpointercancel={onpointerup}
		{onclickcapture}
		role="application"
		aria-label="map of the library, similar items placed together"
	>
		<div class="layer" style:transform="translate({view.x}px, {view.y}px)">
			{#each visible as p (p.item._id)}
				<a
					href={getItemUrl(p.item._id)}
					class={['point', { chip: !p.image, dim: p.dim, hovered: hoveredId === p.item._id }]}
					style:transform="translate(calc({p.x * view.k}px - 50%), calc({p.y * view.k}px - 50%))"
					style:width={p.image ? `${p.image.width}px` : undefined}
					style:height={p.image ? `${p.image.height}px` : undefined}
					draggable="false"
					aria-label={label(p.item)}
					onpointerenter={() => !dragging && (hoveredId = p.item._id)}
					onpointerleave={() => (hoveredId = null)}
					onfocus={() => (hoveredId = p.item._id)}
					onblur={() => (hoveredId = null)}
				>
					{#if p.image && showImages}
						<img src={p.item.imageUrl} alt="" loading="lazy" decoding="async" draggable="false" />
					{:else if p.image}
						<span class="swatch" style:background={p.item.paletteHex?.[0]}></span>
					{:else}
						<span>{label(p.item)}</span>
					{/if}
				</a>
			{/each}
			{#if hovered}
				{@const x = hovered.x * view.k}
				{@const y = hovered.y * view.k - (hovered.image?.height ?? 24) / 2 - 6}
				<div class="tooltip" style:transform="translate(calc({x}px - 50%), calc({y}px - 100%))">
					{label(hovered.item)}
				</div>
			{/if}
		</div>

		{#if placed.length === 0}
			<p class="status-text empty">
				{#if updating || mapQuery.isLoading}
					mapping the library...
				{:else if failed}
					couldn't map the library
				{:else}
					nothing to map yet
				{/if}
			</p>
		{/if}
	</div>

	{#if (collections.data?.length ?? 0) > 0}
		<div class="filter">
			<CollectionFilter
				collections={collections.data ?? []}
				selected={picked}
				onchange={pick}
				count={shown.length}
			/>
		</div>
	{/if}

	<div class="overlay">
		{#if updating && placed.length > 0}
			<span class="status-text">updating map...</span>
		{:else if failed && placed.length > 0}
			<span class="status-text">couldn't update the map</span>
		{/if}
		<div class="controls">
			<button
				class="icon"
				aria-label="zoom in"
				onclick={() => zoomAt(1.5, width / 2, height / 2)}
				disabled={placed.length === 0}
			>
				<IconAdd />
			</button>
			<button
				class="icon"
				aria-label="zoom out"
				onclick={() => zoomAt(1 / 1.5, width / 2, height / 2)}
				disabled={placed.length === 0}
			>
				<IconRemove />
			</button>
			<button
				class="icon"
				aria-label="fit the map"
				onclick={() => (moved = null)}
				disabled={placed.length === 0}
			>
				<IconFit />
			</button>
		</div>
	</div>
</div>

<style>
	.frame {
		position: relative;
		border: 1px solid var(--border);
		background: var(--bg-1);
	}

	.map {
		position: relative;
		height: min(42rem, 75vh);
		min-height: 22rem;
		overflow: hidden;
		touch-action: none;
		user-select: none;
		cursor: grab;
	}

	.map.dragging {
		cursor: grabbing;
	}

	.layer {
		position: absolute;
		top: 0;
		left: 0;
	}

	.point {
		position: absolute;
		top: 0;
		left: 0;
		display: block;
		background: var(--bg-2);
		outline: 1px solid transparent;
		-webkit-user-drag: none;
	}

	.point img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
		pointer-events: none;
	}

	.swatch {
		display: block;
		width: 100%;
		height: 100%;
	}

	.point.chip {
		/* the layer has no width, so a chip would shrink to its longest word */
		width: max-content;
		max-width: 7.5rem;
		padding: 0.25rem 0.375rem;
		border: 1px solid var(--border);
		font-size: 0.6875rem;
		line-height: 1.3;
		color: var(--txt-2);
		text-decoration: none;
	}

	.point.chip span {
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		overflow-wrap: anywhere;
	}

	.point:not(.dim) {
		z-index: 1;
	}

	.point.dim {
		opacity: 0.15;
	}

	.point.hovered,
	.point:focus-visible {
		z-index: 2;
		opacity: 1;
		outline-color: var(--txt-2);
	}

	.map.dragging .point {
		cursor: grabbing;
	}

	.tooltip {
		position: absolute;
		top: 0;
		left: 0;
		z-index: 3;
		width: max-content;
		max-width: 16rem;
		padding: 0.25rem 0.5rem;
		background: var(--bg-1);
		border: 1px solid var(--border);
		font-size: 0.875rem;
		color: var(--txt-2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		pointer-events: none;
	}

	.empty {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		margin: 0;
	}

	.filter {
		position: absolute;
		top: 0.5rem;
		right: 0.5rem;
		z-index: 4;
		background: var(--bg-1);
		border: 1px solid var(--border);
	}

	.overlay {
		position: absolute;
		right: 0.5rem;
		bottom: 0.5rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		pointer-events: none;
	}

	.controls {
		display: flex;
		background: var(--bg-1);
		border: 1px solid var(--border);
		pointer-events: auto;
	}

	.controls button {
		padding: 0.25rem;
	}

	.controls button :global(svg) {
		width: 1.25rem;
		height: 1.25rem;
	}
</style>
