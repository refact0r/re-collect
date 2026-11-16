<script lang="ts">
	import { onDestroy, type Snippet } from 'svelte';
	import { goto } from '$app/navigation';
	import type { Id } from '../../../convex/_generated/dataModel.js';
	import { itemLabel } from '#lib/atlas.js';
	import { getItemUrl, shouldDisplayAsImage } from '#lib/itemDisplay.js';
	import type { DisplayItem } from '#lib/types.js';

	type ItemId = Id<'items'>;

	export interface Placed {
		item: DisplayItem;
		x: number;
		y: number;
	}

	interface MapLabel {
		id: number;
		text: string;
		count: number;
		x: number;
		y: number;
	}

	interface Inset {
		top: number;
		right: number;
		bottom: number;
		left: number;
	}

	interface Props {
		points: Placed[];
		// The items the lenses leave lit; null lights everything
		lit: Set<ItemId> | null;
		// Unlit items vanish instead of dimming (the time-lapse)
		hideUnlit?: boolean;
		selected: Set<ItemId>;
		labels: MapLabel[];
		// A card's longer side in px; cards keep it at any zoom, so zooming in
		// spreads them apart (and each image is decoded at one size)
		thumb: number;
		// A color to ring each item with (the color wheel)
		rings?: Map<ItemId, string> | null;
		// Dragging draws a selection box instead of panning (shift does it too)
		boxMode?: boolean;
		// Room the page's controls take from each edge, kept clear by a fitted view
		inset?: Inset;
		onpick: (id: ItemId, toggle: boolean) => void;
		onbox: (ids: ItemId[]) => void;
		onlabel: (id: number) => void;
		onclear: () => void;
		empty: Snippet;
	}

	let {
		points,
		lit,
		hideUnlit = false,
		selected,
		labels,
		thumb,
		rings = null,
		boxMode = false,
		inset = { top: 0, right: 0, bottom: 0, left: 0 },
		onpick,
		onbox,
		onlabel,
		onclear,
		empty
	}: Props = $props();

	// Zoom limits, relative to the view of the whole map
	const MIN_ZOOM = 0.5;
	const MAX_ZOOM = 40;
	// How far a fit to a few close items may zoom in
	const MAX_FIT_ZOOM = 6;
	const DRAG_THRESHOLD = 4;
	const KEY_PAN = 80;
	const GLIDE_MS = 500;
	// Past this many points on screen, images give way to palette swatches, so the
	// fitted view of a big library doesn't fetch every full-size image
	const MAX_IMAGES = 400;

	interface View {
		k: number; // screen px per map unit
		x: number; // screen position of the map origin
		y: number;
	}

	let width = $state(0);
	let height = $state(0);

	function imageBox(item: DisplayItem) {
		if (!shouldDisplayAsImage(item)) return null;
		const ratio = item.imageWidth && item.imageHeight ? item.imageWidth / item.imageHeight : 1;
		return ratio >= 1
			? { width: thumb, height: Math.round(thumb / ratio) }
			: { width: Math.round(thumb * ratio), height: thumb };
	}

	// The view that shows every given point, and the cards around them, inside the inset
	function fitTo(framed: Placed[]): View {
		if (framed.length === 0 || width === 0) return { k: 1, x: 0, y: 0 };
		const margin = 12 + thumb / 2;
		const left = inset.left + margin;
		const top = inset.top + margin;
		const w = Math.max(width - inset.right - margin - left, 40);
		const h = Math.max(height - inset.bottom - margin - top, 40);
		const xs = framed.map((p) => p.x);
		const ys = framed.map((p) => p.y);
		const [minX, maxX, minY, maxY] = [
			Math.min(...xs),
			Math.max(...xs),
			Math.min(...ys),
			Math.max(...ys)
		];
		const k = Math.min(w / Math.max(maxX - minX, 0.5), h / Math.max(maxY - minY, 0.5));
		return {
			k,
			x: left + w / 2 - (k * (minX + maxX)) / 2,
			y: top + h / 2 - (k * (minY + maxY)) / 2
		};
	}

	// The view of the whole map, which the zoom limits are relative to
	const whole = $derived(fitTo(points));
	// The items a fit frames (all of them when null); the view follows new
	// layouts, resizes and panels until the user pans or zooms
	let frame = $state<Set<ItemId> | null>(null);
	const fitted = $derived.by((): View => {
		const framed = frame && points.filter((p) => frame!.has(p.item._id));
		if (!framed?.length) return whole;
		const view = fitTo(framed);
		const k = Math.min(view.k, whole.k * MAX_FIT_ZOOM);
		// zoom about the middle of the clear area the fit centred the frame in
		const cx = (width + inset.left - inset.right) / 2;
		const cy = (height + inset.top - inset.bottom) / 2;
		return { k, x: cx - ((cx - view.x) * k) / view.k, y: cy - ((cy - view.y) * k) / view.k };
	});
	let moved = $state<View | null>(null);
	const view = $derived(moved ?? fitted);

	// Programmatic moves glide; the user's own pans and zooms don't
	let gliding = $state(false);
	let glideTimer: ReturnType<typeof setTimeout> | undefined;
	export function glide() {
		gliding = true;
		clearTimeout(glideTimer);
		glideTimer = setTimeout(() => (gliding = false), GLIDE_MS);
	}

	// The user taking over mid-glide moves the map at once, not 500ms behind
	function stopGlide() {
		clearTimeout(glideTimer);
		gliding = false;
	}

	onDestroy(() => clearTimeout(glideTimer));

	// Frames the given items, or the whole map
	export function fit(ids?: ItemId[]) {
		glide();
		frame = ids?.length ? new Set(ids) : null;
		moved = null;
	}

	export function zoomBy(factor: number) {
		glide();
		zoomAt(factor, width / 2, height / 2);
	}

	function zoomAt(factor: number, cx: number, cy: number) {
		const k = Math.min(whole.k * MAX_ZOOM, Math.max(whole.k * MIN_ZOOM, view.k * factor));
		const f = k / view.k;
		moved = { k, x: cx - (cx - view.x) * f, y: cy - (cy - view.y) * f };
	}

	function panBy(dx: number, dy: number) {
		moved = { ...view, x: view.x + dx, y: view.y + dy };
	}

	const screen = (p: Placed) => ({ x: view.x + p.x * view.k, y: view.y + p.y * view.k });

	// Only points on screen are drawn, except during a glide, where the ones
	// leaving the view should be seen to leave
	const onScreen = $derived(
		points.filter((p) => {
			const { x, y } = screen(p);
			return x > -thumb && x < width + thumb && y > -thumb && y < height + thumb;
		})
	);
	const visible = $derived(gliding && points.length <= MAX_IMAGES ? points : onScreen);
	const showImages = $derived(visible.length <= MAX_IMAGES);

	let dragging = $state(false);
	let hoveredId = $state<string | null>(null);
	const hovered = $derived(points.find((p) => p.item._id === hoveredId));

	function local(e: MouseEvent) {
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		return { x: e.clientX - rect.left, y: e.clientY - rect.top };
	}

	// Svelte's onwheel is passive, and zooming has to stop the browser's own pinch zoom.
	// A trackpad sends wheel events faster than frames, so a frame's worth of them
	// is applied as one zoom.
	function wheelZoom(el: HTMLElement) {
		let pending: { factor: number; x: number; y: number } | null = null;
		let raf = 0;
		const onWheel = (e: WheelEvent) => {
			e.preventDefault();
			stopGlide();
			const { x, y } = local(e);
			const delta = e.deltaY * (e.deltaMode === 1 ? 16 : 1);
			// a trackpad pinch arrives as ctrl+wheel with small deltas
			const factor = Math.exp(-delta * (e.ctrlKey ? 0.01 : 0.002));
			if (pending) {
				pending = { factor: pending.factor * factor, x, y };
				return;
			}
			pending = { factor, x, y };
			raf = requestAnimationFrame(() => {
				zoomAt(pending!.factor, pending!.x, pending!.y);
				pending = null;
			});
		};
		el.addEventListener('wheel', onWheel, { passive: false });
		return () => {
			el.removeEventListener('wheel', onWheel);
			cancelAnimationFrame(raf);
		};
	}

	// Pressed pointers' last positions; event bookkeeping, nothing renders from it
	const pointers = new Map<number, { x: number; y: number }>();
	let start = { x: 0, y: 0 };
	// Set once a press moves far enough to be a drag, so its click doesn't pick an item
	let dragged = false;
	// Whether this press draws a selection box, and the box so far
	let boxing = false;
	let box = $state<{ x: number; y: number; width: number; height: number } | null>(null);

	function onpointerdown(e: PointerEvent) {
		if (e.pointerType === 'mouse' && e.button !== 0) return;
		const p = local(e);
		pointers.set(e.pointerId, p);
		if (pointers.size === 1) {
			start = p;
			dragged = false;
			boxing = boxMode || e.shiftKey;
		} else {
			boxing = false;
			box = null;
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
			if (!boxing) stopGlide();
			const el = e.currentTarget as HTMLElement;
			for (const id of pointers.keys()) el.setPointerCapture(id);
		}
		pointers.set(e.pointerId, p);
		if (boxing) {
			box = {
				x: Math.min(start.x, p.x),
				y: Math.min(start.y, p.y),
				width: Math.abs(p.x - start.x),
				height: Math.abs(p.y - start.y)
			};
			return;
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
	}

	function onpointerup(e: PointerEvent) {
		pointers.delete(e.pointerId);
		if (pointers.size > 0) return;
		dragging = false;
		if (box) {
			const { x, y, width: w, height: h } = box;
			const inside = points.filter((p) => {
				const at = screen(p);
				return at.x >= x && at.x <= x + w && at.y >= y && at.y <= y + h && isLit(p.item._id);
			});
			box = null;
			if (e.type === 'pointerup') onbox(inside.map((p) => p.item._id));
		}
	}

	// A drag ends with a click, which mustn't pick anything; a plain click on the
	// map itself drops the selection
	function onclickcapture(e: MouseEvent) {
		if (dragged) {
			dragged = false;
			e.preventDefault();
			e.stopPropagation();
		} else if (e.target === e.currentTarget) {
			onclear();
		}
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.target !== e.currentTarget && e.key !== 'Escape') return;
		const pan: Record<string, [number, number]> = {
			ArrowLeft: [KEY_PAN, 0],
			ArrowRight: [-KEY_PAN, 0],
			ArrowUp: [0, KEY_PAN],
			ArrowDown: [0, -KEY_PAN]
		};
		if (pan[e.key]) {
			glide();
			panBy(...pan[e.key]);
		} else if (e.key === '+' || e.key === '=') zoomBy(1.5);
		else if (e.key === '-') zoomBy(1 / 1.5);
		else if (e.key === '0') fit();
		else if (e.key === 'Escape') onclear();
		else return;
		e.preventDefault();
	}

	const isLit = (id: ItemId) => !lit || lit.has(id);

	function pick(e: MouseEvent, id: ItemId) {
		// cmd/ctrl-click keeps the link's own behaviour (the item in a new tab)
		if (e.metaKey || e.ctrlKey) return;
		e.preventDefault();
		onpick(id, e.shiftKey);
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
	class={['map', { dragging, gliding, boxing: boxMode }]}
	bind:clientWidth={width}
	bind:clientHeight={height}
	{@attach wheelZoom}
	{onpointerdown}
	{onpointermove}
	{onpointerup}
	onpointercancel={onpointerup}
	{onclickcapture}
	{onkeydown}
	tabindex="0"
	role="application"
	aria-label="map of the library, similar items placed together"
>
	<!-- cards, names and the hover label keep their size at any zoom; only where they sit scales -->
	<div class="layer" style:transform="translate({view.x}px, {view.y}px)">
		{#each visible as p (p.item._id)}
			{@const id = p.item._id}
			{@const image = imageBox(p.item)}
			<a
				href={getItemUrl(id)}
				class={[
					'point',
					{
						chip: !image,
						imaged: image && showImages,
						ringed: rings?.has(id),
						dim: !isLit(id),
						hidden: hideUnlit && !isLit(id),
						selected: selected.has(id),
						hovered: hoveredId === id
					}
				]}
				style:transform="translate(calc({p.x * view.k}px - 50%), calc({p.y * view.k}px - 50%))"
				style:width={image ? `${image.width}px` : undefined}
				style:height={image ? `${image.height}px` : undefined}
				style:--ring={rings?.get(id)}
				draggable="false"
				aria-label={itemLabel(p.item)}
				aria-current={selected.has(id) ? 'true' : undefined}
				onclick={(e) => pick(e, id)}
				ondblclick={() => goto(getItemUrl(id))}
				onpointerenter={() => !dragging && (hoveredId = id)}
				onpointerleave={() => (hoveredId = null)}
				onfocus={() => (hoveredId = id)}
				onblur={() => (hoveredId = null)}
			>
				{#if image && showImages}
					<img
						src={p.item.imageUrl}
						srcset={p.item.imageSrcset}
						sizes="{image.width}px"
						alt=""
						loading="lazy"
						decoding="async"
						draggable="false"
					/>
				{:else if image}
					<span class="swatch" style:background={p.item.paletteHex?.[0]}></span>
				{:else}
					<span>{itemLabel(p.item)}</span>
				{/if}
			</a>
		{/each}

		{#each labels as label (label.id)}
			<button
				class="label"
				style:transform="translate(calc({label.x * view.k}px - 50%), calc({label.y * view.k}px -
				50%))"
				onclick={() => onlabel(label.id)}
			>
				{label.text}
				<span class="count">{label.count}</span>
			</button>
		{/each}

		{#if hovered}
			{@const x = hovered.x * view.k}
			{@const y = hovered.y * view.k - (imageBox(hovered.item)?.height ?? 24) / 2 - 6}
			<div class="tooltip" style:transform="translate(calc({x}px - 50%), calc({y}px - 100%))">
				{itemLabel(hovered.item)}
			</div>
		{/if}
	</div>

	{#if box}
		<div
			class="box"
			style:left="{box.x}px"
			style:top="{box.y}px"
			style:width="{box.width}px"
			style:height="{box.height}px"
		></div>
	{/if}

	{#if points.length === 0}
		<p class="status-text empty">{@render empty()}</p>
	{/if}
</div>

<style>
	.map {
		position: absolute;
		inset: 0;
		overflow: hidden;
		touch-action: none;
		user-select: none;
		cursor: grab;
		/* a faint grid of dots, so an empty stretch still reads as a surface */
		background:
			radial-gradient(circle, var(--bg-3) 1px, transparent 1px) 0 0 / 2rem 2rem,
			var(--bg-1);
	}

	.map:focus-visible {
		outline: 1px solid var(--txt-3);
		outline-offset: -1px;
	}

	.map.boxing {
		cursor: crosshair;
	}

	.map.dragging:not(.boxing) {
		cursor: grabbing;
	}

	.layer {
		position: absolute;
		top: 0;
		left: 0;
	}

	.point,
	.label,
	.tooltip {
		position: absolute;
		top: 0;
		left: 0;
	}

	.gliding .layer,
	.gliding .label {
		transition: transform 500ms cubic-bezier(0.2, 0.7, 0.2, 1);
	}

	.point {
		display: block;
		background: var(--bg-2);
		outline: 1px solid transparent;
		z-index: 1;
		-webkit-user-drag: none;
		transition:
			opacity 200ms ease,
			width 150ms ease,
			height 150ms ease;
	}

	/* each image card is its own layer, so a pan or zoom only moves it: its
	   image, drawn small from a full-size screenshot, is never painted again
	   (plain swatches and chips are cheap to repaint, and too many to layer) */
	.point.imaged {
		will-change: transform;
	}

	.gliding .point {
		transition:
			transform 500ms cubic-bezier(0.2, 0.7, 0.2, 1),
			opacity 200ms ease;
	}

	.point.ringed {
		box-shadow: 0 0 0 2px var(--ring);
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
		padding: var(--pad-y-xs) var(--pad-x-xs);
		border: 1px solid var(--border);
		font-size: var(--text-xs);
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

	.point.dim {
		z-index: 0;
		opacity: 0.04;
	}

	.point.hidden {
		opacity: 0;
		pointer-events: none;
	}

	.point.hovered,
	.point:focus-visible {
		z-index: 2;
		opacity: 1;
		outline-color: var(--txt-2);
	}

	.point.selected {
		z-index: 2;
		opacity: 1;
		outline: 2px solid var(--txt-1);
		outline-offset: 1px;
	}

	.map.dragging .point {
		cursor: inherit;
	}

	.label {
		z-index: 3;
		gap: var(--space-sm);
		padding: var(--pad-y-xs) var(--pad-x-xs);
		font-size: var(--text-xs);
		line-height: 1.4;
		white-space: nowrap;
		color: var(--txt-1);
	}

	.label:hover {
		background: var(--bg-3);
	}

	.label .count {
		color: var(--txt-3);
		font-variant-numeric: tabular-nums;
	}

	.tooltip {
		z-index: 4;
		width: max-content;
		max-width: 16rem;
		padding: var(--pad-y-sm) var(--pad-x-sm);
		background: var(--bg-1);
		border: 1px solid var(--border);
		font-size: var(--text-sm);
		color: var(--txt-2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		pointer-events: none;
	}

	.box {
		position: absolute;
		z-index: 5;
		border: 1px solid var(--txt-2);
		background: oklch(from var(--txt-1) l c h / 0.08);
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
</style>
