<script lang="ts">
	import { page } from '$app/state';
	import { getContext, untrack } from 'svelte';
	import { useConvexClient, useQuery } from 'convex-svelte';
	import { api } from '../../../convex/_generated/api.js';
	import type { Id } from '../../../convex/_generated/dataModel.js';
	import ItemGrid from '$lib/components/ItemGrid.svelte';
	import ItemList from '$lib/components/ItemList.svelte';
	import ViewToggle, { type ViewMode } from '$lib/components/ViewToggle.svelte';
	import { mutate } from '$lib/mutationHelper.js';

	const client = useConvexClient();
	const getWriteToken = getContext<() => string | null>('writeToken');
	const writeToken = $derived(getWriteToken());
	const currentItemsContext = getContext<{
		items: any[];
		setItems: (items: any[]) => void;
	}>('currentItems');

	let viewMode = $state<ViewMode>('grid');
	let prefsInitialized = $state(false);

	// Load saved preferences
	const savedPrefs = useQuery(api.viewPreferences.get, () => ({ key: 'search' }));

	// Initialize preferences from DB once loaded
	$effect(() => {
		const prefs = savedPrefs.data;
		if (prefs !== undefined && !prefsInitialized) {
			untrack(() => {
				if (prefs) {
					viewMode = (prefs.viewMode as ViewMode) ?? 'grid';
				}
				prefsInitialized = true;
			});
		}
	});

	function handleViewModeChange(newMode: ViewMode) {
		viewMode = newMode;
		if (prefsInitialized) {
			mutate(writeToken, (token) =>
				client.mutation(api.viewPreferences.set, { key: 'search', viewMode: newMode, token })
			);
		}
	}

	const searchQuery = $derived(page.url.searchParams.get('q') ?? '');
	const searchResults = useQuery(api.items.search, () => ({ query: searchQuery }));

	$effect(() => {
		if (searchResults.data) {
			currentItemsContext.setItems(searchResults.data);
		}
	});

	async function handleRetryScreenshot(itemId: Id<'items'>) {
		await mutate(writeToken, (token) =>
			client.mutation(api.screenshots.retryScreenshot, { itemId, token })
		);
	}

	async function handleDeleteItem(itemId: Id<'items'>) {
		await mutate(writeToken, (token) => client.mutation(api.items.remove, { id: itemId, token }));
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
