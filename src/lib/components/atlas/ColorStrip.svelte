<script lang="ts">
	import { cellsOf, type Swatch } from '#lib/atlas.js';

	// The given swatches as bands of color, neighbours sharing one past
	// MAX_CELLS; height via --strip-height
	let { swatches }: { swatches: Swatch[] } = $props();

	const cells = $derived(cellsOf(swatches));
</script>

<div class="strip" role="presentation">
	{#each cells as cell (cell.from)}
		<span style:background={cell.hex}></span>
	{/each}
</div>

<style>
	.strip {
		display: flex;
		height: var(--strip-height, 0.5rem);
		overflow: hidden;
	}

	span {
		flex: 1 1 0;
		min-width: 0;
	}
</style>
