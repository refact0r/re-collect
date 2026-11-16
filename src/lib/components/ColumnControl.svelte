<script lang="ts">
	import { GAP, columnCountFor } from '#lib/masonry.js';
	import IconRemove from '~icons/material-symbols-light/remove-sharp';
	import IconAdd from '~icons/material-symbols-light/add-sharp';

	interface Props {
		// Offset from the width-derived column count
		value: number;
		onchange: (offset: number) => void;
	}

	let { value, onchange }: Props = $props();

	// The grids fill <main>'s content box, so its width gives their column count
	// (rounded, as their clientWidth is), and its padding is var(--gutter), their
	// gap, in pixels. The padding narrows with the gutter, so a change reports here.
	let width = $state(0);
	let gap = $state(GAP);

	function measureMain(node: HTMLElement) {
		const main = node.closest('main');
		if (!main) return;
		const observer = new ResizeObserver(([entry]) => {
			gap = parseFloat(getComputedStyle(main).paddingLeft) || GAP;
			width = Math.round(entry.contentRect.width);
		});
		observer.observe(main);
		return () => observer.disconnect();
	}

	// Steps the shown count, so an offset never runs past the grid's clamp (where
	// clicks would do nothing here and still shift wider screens)
	const auto = $derived(columnCountFor(width, 0, gap));
	const count = $derived(columnCountFor(width, value, gap));
	const offsetFor = (delta: number) => count + delta - auto;
	const canStep = (delta: number) =>
		width > 0 && columnCountFor(width, offsetFor(delta), gap) !== count;
</script>

<div class="column-control" {@attach measureMain}>
	<button
		class="icon-filled"
		title="Fewer columns"
		disabled={!canStep(-1)}
		onclick={() => onchange(offsetFor(-1))}
	>
		<IconRemove />
	</button>
	<button
		class="icon-filled"
		title="More columns"
		disabled={!canStep(1)}
		onclick={() => onchange(offsetFor(1))}
	>
		<IconAdd />
	</button>
</div>

<style>
	.column-control {
		display: flex;
	}

	.column-control button {
		border-radius: 0;
	}

	.column-control button:first-child {
		border-right: none;
	}
</style>
