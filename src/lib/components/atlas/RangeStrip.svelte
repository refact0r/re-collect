<script lang="ts">
	import type { Snippet } from 'svelte';

	type Range = [number, number];

	interface Props {
		count: number;
		// Cell indexes, both ends included
		range: Range | null;
		onchange: (range: Range | null) => void;
		cell: Snippet<[index: number, inRange: boolean]>;
		label: string;
		// Read out in place of the cell numbers, e.g. the months a range covers
		valuetext?: string;
		// A plain click picks this many cells either side of the one clicked
		clickSpan?: number;
	}

	let { count, range, onchange, cell, label, valuetext, clickSpan = 0 }: Props = $props();

	const DRAG_THRESHOLD = 3;

	let strip: HTMLDivElement;
	let drag: { anchor: number; startX: number; moved: boolean; wasInRange: boolean } | null = null;

	const clamp = (i: number, min = 0, max = count - 1) => Math.min(max, Math.max(min, i));
	const inRange = (i: number) => !!range && i >= range[0] && i <= range[1];
	const around = (i: number): Range => [clamp(i - clickSpan), clamp(i + clickSpan)];

	function indexAt(clientX: number) {
		const box = strip.getBoundingClientRect();
		return clamp(Math.floor(((clientX - box.left) / box.width) * count));
	}

	function onpointerdown(e: PointerEvent) {
		if (e.button !== 0 || count === 0) return;
		strip.setPointerCapture(e.pointerId);
		const anchor = indexAt(e.clientX);
		drag = { anchor, startX: e.clientX, moved: false, wasInRange: inRange(anchor) };
	}

	function onpointermove(e: PointerEvent) {
		if (!drag) return;
		if (!drag.moved && Math.abs(e.clientX - drag.startX) < DRAG_THRESHOLD) return;
		drag.moved = true;
		const i = indexAt(e.clientX);
		onchange([Math.min(drag.anchor, i), Math.max(drag.anchor, i)]);
	}

	function onpointerup() {
		if (!drag) return;
		const { anchor, moved, wasInRange } = drag;
		drag = null;
		if (moved) return;
		onchange(wasInRange ? null : around(anchor));
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			if (range) onchange(null);
			return;
		}
		const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
		if (!step || count === 0) return;
		e.preventDefault();
		if (!range) {
			onchange(around(step > 0 ? clickSpan : count - 1 - clickSpan));
		} else if (e.shiftKey) {
			onchange([range[0], clamp(range[1] + step, range[0])]);
		} else {
			const shift = clamp(step, -range[0], count - 1 - range[1]);
			onchange([range[0] + shift, range[1] + shift]);
		}
	}
</script>

<div
	bind:this={strip}
	class="strip"
	role="slider"
	tabindex="0"
	aria-label={label}
	aria-valuemin={0}
	aria-valuemax={Math.max(0, count - 1)}
	aria-valuenow={range?.[0] ?? 0}
	aria-valuetext={valuetext ?? (range ? `${range[0] + 1} to ${range[1] + 1} of ${count}` : 'all')}
	{onpointerdown}
	{onpointermove}
	{onpointerup}
	onpointercancel={() => (drag = null)}
	{onkeydown}
>
	{#each { length: count }, i (i)}
		<div class={['cell', { dim: !!range && !inRange(i) }]}>
			{@render cell(i, inRange(i))}
		</div>
	{/each}
	{#if range}
		<div
			class="window"
			style:left="{(range[0] / count) * 100}%"
			style:width="{((range[1] - range[0] + 1) / count) * 100}%"
		></div>
	{/if}
</div>

<style>
	.strip {
		position: relative;
		display: flex;
		align-items: stretch;
		width: 100%;
		height: var(--strip-height, 2rem);
		cursor: crosshair;
		touch-action: none;
		user-select: none;
	}

	.strip:focus-visible {
		outline: 1px solid var(--txt-3);
		outline-offset: 1px;
	}

	.cell {
		flex: 1 1 0;
		min-width: 0;
		display: flex;
		align-items: flex-end;
	}

	.cell.dim {
		opacity: 0.25;
	}

	.window {
		position: absolute;
		top: -2px;
		bottom: -2px;
		border: 1px solid var(--txt-2);
		pointer-events: none;
	}
</style>
