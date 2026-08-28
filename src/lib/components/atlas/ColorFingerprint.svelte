<script lang="ts">
	import { goto } from '$app/navigation';
	import { getItemUrl } from '$lib/itemDisplay.js';
	import type { Swatch } from '$lib/atlas.js';

	let { swatches }: { swatches: Swatch[] } = $props();

	let tip = $state<{ x: number; y: number; swatch: Swatch } | null>(null);

	function showTip(e: MouseEvent, swatch: Swatch) {
		tip = { x: e.clientX, y: e.clientY, swatch };
	}
</script>

<div class="strip" role="presentation" onmouseleave={() => (tip = null)}>
	{#each swatches as swatch, i (i)}
		<button
			class="swatch"
			style:background={swatch.hex}
			aria-label="{swatch.hex} from {swatch.label}"
			onmouseenter={(e) => showTip(e, swatch)}
			onmousemove={(e) => showTip(e, swatch)}
			onclick={() => goto(getItemUrl(swatch.itemId))}
		></button>
	{/each}
</div>

{#if tip}
	<div class="tooltip" style:left="{tip.x}px" style:top="{tip.y}px">
		<span class="hex">{tip.swatch.hex}</span>
		<span class="label">{tip.swatch.label}</span>
	</div>
{/if}

<style>
	.strip {
		display: flex;
		height: 4.5rem;
		width: 100%;
		overflow: hidden;
	}

	.swatch {
		flex: 1 1 0;
		min-width: 0;
		border: none;
		padding: 0;
		cursor: pointer;
	}

	.tooltip {
		position: fixed;
		transform: translate(-50%, calc(-100% - 0.75rem));
		background: var(--bg-1);
		border: 1px solid var(--border);
		padding: 0.25rem 0.5rem;
		font-size: 0.875rem;
		pointer-events: none;
		z-index: 100;
		display: flex;
		gap: 0.5rem;
		max-width: 24rem;
	}

	.tooltip .hex {
		color: var(--txt-3);
		font-variant-numeric: tabular-nums;
	}

	.tooltip .label {
		color: var(--txt-2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
