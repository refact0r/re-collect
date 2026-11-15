<script lang="ts">
	import type { Swatch } from '#lib/atlas.js';

	// Every given swatch as one band of color; height via --strip-height
	let { swatches }: { swatches: Swatch[] } = $props();
</script>

<div class="strip" role="presentation">
	{#each swatches as swatch, i (i)}
		<span style:background={swatch.hex}></span>
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
