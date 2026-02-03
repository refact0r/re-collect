<script lang="ts">
	import { page } from '$app/state';
	import { getContext } from 'svelte';
	import { browser } from '$app/environment';
	import { useConvexClient, useQuery } from 'convex-svelte';
	import { api } from '../../../convex/_generated/api.js';
	import type { Id } from '../../../convex/_generated/dataModel.js';
	import ItemGrid from '$lib/components/ItemGrid.svelte';
	import ItemList from '$lib/components/ItemList.svelte';
	import ViewToggle, { type ViewMode } from '$lib/components/ViewToggle.svelte';

	const STORAGE_KEY = 'recollect:search-prefs';

	const client = useConvexClient();
	const currentItemsContext = getContext<{
		items: any[];
		setItems: (items: any[]) => void;
	}>('currentItems');

	function loadViewMode(): ViewMode {
		if (!browser) return 'grid';
		try {
			const saved = localStorage.getItem(STORAGE_KEY);
			if (saved) {
				const parsed = JSON.parse(saved);
				return parsed.viewMode ?? 'grid';
			}
		} catch {
			// Ignore parse errors
		}
		return 'grid';
	}

	function saveViewMode(mode: ViewMode) {
		if (!browser) return;
		localStorage.setItem(STORAGE_KEY, JSON.stringify({ viewMode: mode }));
	}

	let viewMode = $state<ViewMode>(loadViewMode());

	function handleViewModeChange(newMode: ViewMode) {
		viewMode = newMode;
		saveViewMode(newMode);
	}

	const searchQuery = $derived(page.url.searchParams.get('q') ?? '');
	const searchResults = useQuery(api.items.search, () => ({ query: searchQuery }));

	$effect(() => {
		if (searchResults.data) {
			currentItemsContext.setItems(searchResults.data);
		}
	});

	async function handleRetryScreenshot(itemId: Id<'items'>) {
		await client.mutation(api.screenshots.retryScreenshot, { itemId });
	}

	async function handleDeleteItem(itemId: Id<'items'>) {
		await client.mutation(api.items.remove, { id: itemId });
	}
</script>

<div class="container">
	{#if !searchQuery.trim()}
		<p class="status-text">type to search across your items</p>
	{:else if searchResults.isLoading}
		<p class="status-text">searching...</p>
	{:else if searchResults.error}
		<p class="status-text">error: {searchResults.error.message}</p>
	{:else if searchResults.data?.length === 0}
		<p class="status-text">no items found for "{searchQuery}"</p>
	{:else}
		<div class="results-header">
			<p class="status-text result-count">
				{searchResults.data?.length}
				{searchResults.data?.length === 1 ? 'result' : 'results'}
			</p>
			<ViewToggle value={viewMode} onchange={handleViewModeChange} />
		</div>
		{#if viewMode === 'list'}
			<ItemList items={searchResults.data ?? []} onRetryScreenshot={handleRetryScreenshot} />
		{:else}
			<ItemGrid items={searchResults.data ?? []} onRetryScreenshot={handleRetryScreenshot} />
		{/if}
	{/if}
</div>

<style>
	.results-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.5rem;
	}

	.result-count {
		margin: 0;
	}
</style>
