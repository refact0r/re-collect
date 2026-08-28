<script lang="ts">
	import { getItemsContext, getCurrentItemsContext } from '$lib/context.js';
	import { buildAtlas } from '$lib/atlas.js';
	import ColorFingerprint from '$lib/components/atlas/ColorFingerprint.svelte';
	import StyleConstellation from '$lib/components/atlas/StyleConstellation.svelte';

	const itemsQuery = getItemsContext();
	const currentItemsContext = getCurrentItemsContext();

	const atlas = $derived(itemsQuery.data ? buildAtlas(itemsQuery.data) : null);

	// so the item modal opened from a swatch/column has the full list for context
	$effect(() => {
		if (itemsQuery.data) {
			currentItemsContext.setItems(itemsQuery.data);
		}
	});

	const since = $derived(
		atlas?.firstDate
			? new Date(atlas.firstDate)
					.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
					.toLowerCase()
			: null
	);
</script>

<div class="container">
	{#if itemsQuery.isLoading}
		<p class="status-text">loading...</p>
	{:else if itemsQuery.error}
		<p class="status-text">error: {itemsQuery.error.message}</p>
	{:else if atlas}
		<div class="page-header">
			<h1>atlas</h1>
			{#if since}
				<p class="meta">collecting since {since}</p>
			{/if}
		</div>

		<div class="stats">
			<div class="stat">
				<span class="stat-value">{atlas.itemCount}</span>
				<span class="stat-label">items</span>
			</div>
			<div class="stat">
				<span class="stat-value">{atlas.styles.length}</span>
				<span class="stat-label">styles</span>
			</div>
			<div class="stat">
				<span class="stat-value">{atlas.tags.length}</span>
				<span class="stat-label">tags</span>
			</div>
			<div class="stat">
				<span class="stat-value">{atlas.swatches.length}</span>
				<span class="stat-label">colors</span>
			</div>
		</div>

		{#if atlas.swatches.length === 0 && atlas.styles.length === 0}
			<p class="status-text">nothing to map yet — add some items and let tagging run</p>
		{:else}
			{#if atlas.swatches.length > 0}
				<section>
					<h3>color fingerprint</h3>
					<p class="meta">
						every palette color in the library, swept by hue — click one to open its item
					</p>
					<ColorFingerprint swatches={atlas.swatches} />
				</section>
			{/if}

			{#if atlas.styles.length > 2}
				<section>
					<h3>style constellation</h3>
					<p class="meta">
						styles pull together when they appear on the same item — click one to search it
					</p>
					<StyleConstellation styles={atlas.styles} pairs={atlas.pairs} />
				</section>
			{/if}
		{/if}
	{/if}
</div>

<style>
	.container {
		display: flex;
		flex-direction: column;
		gap: 2rem;
		max-width: 64rem;
		margin: 0 auto;
		padding-bottom: 2rem;
	}

	.page-header {
		margin-bottom: 0;
	}

	.stats {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: var(--spacing);
	}

	.stat {
		display: flex;
		flex-direction: column;
		border: 1px solid var(--border);
		background: var(--bg-2);
		padding: 0.75rem 1rem;
	}

	.stat-value {
		font-size: 2rem;
		font-weight: 500;
		letter-spacing: -0.02ch;
		color: var(--txt-1);
		line-height: 1.2;
		font-variant-numeric: tabular-nums;
	}

	.stat-label {
		font-size: 0.875rem;
		color: var(--txt-3);
	}

	section {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		min-width: 0;
	}

	section .meta {
		margin-top: -0.5rem;
	}

	@media (max-width: 768px) {
		.stats {
			grid-template-columns: repeat(2, 1fr);
		}

		.page-header {
			flex-direction: column;
			align-items: flex-start;
			gap: 0.25rem;
		}
	}
</style>
