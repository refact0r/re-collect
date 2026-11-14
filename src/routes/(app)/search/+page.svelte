<script lang="ts">
	import { page } from '$app/state';
	import { api } from '../../../convex/_generated/api.js';
	import ItemsView from '#lib/components/ItemsView.svelte';
	import ViewToggle from '#lib/components/ViewToggle.svelte';
	import ColumnControl from '#lib/components/ColumnControl.svelte';
	import SettingsMenu from '#lib/components/SettingsMenu.svelte';
	import { useQuery } from '#lib/convex.js';
	import { useViewPrefs } from '#lib/prefs.svelte.js';

	const prefs = useViewPrefs('search');
	const searchQuery = $derived(page.url.searchParams.get('q') ?? '');
	// The previous results stay up while the next search runs
	const results = useQuery(
		api.items.search,
		() => (searchQuery.trim() ? { query: searchQuery } : 'skip'),
		{ keepPreviousData: true }
	);
</script>

{#if !searchQuery.trim()}
	<p class="status-text">type to search across your items</p>
{:else}
	{#if results.data?.length}
		<div class="results-header">
			<p class="status-text result-count">
				{results.data.length}
				{results.data.length === 1 ? 'result' : 'results'}
			</p>
			<div class="view-controls">
				{#if prefs.viewMode === 'grid'}
					<ColumnControl
						value={prefs.columnOffset}
						onchange={(columnOffset) => prefs.set({ columnOffset })}
					/>
				{/if}
				<ViewToggle value={prefs.viewMode} onchange={(viewMode) => prefs.set({ viewMode })} />
				<SettingsMenu
					showIngestion={false}
					showTitles={prefs.showTitles}
					onShowTitlesChange={(showTitles) => prefs.set({ showTitles })}
				/>
			</div>
		</div>
	{/if}
	<ItemsView
		items={results}
		{prefs}
		loading="searching..."
		empty={`no items found for "${searchQuery}"`}
	/>
{/if}

<style>
	.results-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.5rem;
	}

	.view-controls {
		display: flex;
		gap: 0.5rem;
	}

	.result-count {
		margin: 0;
	}
</style>
