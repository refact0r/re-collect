<script lang="ts">
	import { page } from '$app/state';
	import { api } from '../../../convex/_generated/api.js';
	import type { Id } from '../../../convex/_generated/dataModel.js';
	import ItemsView from '#lib/components/ItemsView.svelte';
	import ViewToggle from '#lib/components/ViewToggle.svelte';
	import ColumnControl from '#lib/components/ColumnControl.svelte';
	import SettingsMenu from '#lib/components/SettingsMenu.svelte';
	import { useAction, useQuery } from '#lib/convex.js';
	import { getItemsContext } from '#lib/context.js';
	import { useViewPrefs } from '#lib/prefs.svelte.js';
	import { mergeSearch, type MergedSearch } from '#lib/searchMerge.js';
	import type { DisplayItem } from '#lib/types.js';

	const prefs = useViewPrefs('search');
	const searchQuery = $derived(page.url.searchParams.get('q') ?? '');
	const query = $derived(searchQuery.trim());
	const allItems = getItemsContext();
	const runAction = useAction();

	// The keyword half of a hybrid search (full-text over searchText)
	const keyword = useQuery(api.items.search, () => (query ? { query } : 'skip'), {
		keepPreviousData: true
	});

	// The semantic half: the item ids nearest the query, best first. A failed
	// run comes back empty, leaving the keyword results as they are.
	let nearest = $state<{ query: string; ids: Id<'items'>[] }>();
	$effect(() => {
		const current = query;
		if (!current) return;
		let live = true;
		runAction(api.embeddings.search, { query: current }, { onError: () => {} }).then((ids) => {
			if (live) nearest = { query: current, ids: ids ?? [] };
		});
		return () => {
			live = false;
		};
	});

	// Results change once both halves are in for the current query; until
	// then the previous ones stay up, so nothing reshuffles under the cursor
	let merged = $state<MergedSearch<DisplayItem>>();
	$effect(() => {
		if (!keyword.data || keyword.isStale || nearest?.query !== query) return;
		const byId = new Map((allItems.data ?? []).map((item) => [item._id, item]));
		merged = mergeSearch<DisplayItem>(keyword.data, nearest.ids, (id) => byId.get(id));
	});

	const results = $derived({
		data: merged && [...merged.matches, ...merged.similar],
		error: keyword.error,
		isLoading: !merged
	});
</script>

{#if !searchQuery.trim()}
	<p class="status-text">type to search across your items</p>
{:else}
	{#if merged && results.data?.length}
		<div class="results-header">
			<p class="status-text result-count">
				{#if merged.matches.length}
					{merged.matches.length}
					{merged.matches.length === 1 ? 'result' : 'results'}
				{:else}
					no exact matches
				{/if}
				{#if merged.similar.length}
					+ {merged.similar.length} similar
				{/if}
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
