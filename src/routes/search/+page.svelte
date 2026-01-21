<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { getContext } from 'svelte';
	import { useConvexClient, useQuery } from 'convex-svelte';
	import { api } from '../../convex/_generated/api.js';
	import type { Id } from '../../convex/_generated/dataModel.js';
	import ItemGrid from '$lib/components/ItemGrid.svelte';

	const client = useConvexClient();
	const currentItemsContext = getContext<{
		items: any[];
		setItems: (items: any[]) => void;
	}>('currentItems');

	// Get search query from URL
	let searchInput = $state(page.url.searchParams.get('q') ?? '');
	let debouncedQuery = $state(page.url.searchParams.get('q') ?? '');
	let lastUrlQuery = $state(page.url.searchParams.get('q') ?? '');
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;

	// Sync URL changes to search input
	$effect(() => {
		const currentUrlQuery = page.url.searchParams.get('q') ?? '';
		if (currentUrlQuery !== lastUrlQuery) {
			searchInput = currentUrlQuery;
			debouncedQuery = currentUrlQuery;
			lastUrlQuery = currentUrlQuery;
		}
	});

	// Update URL when search query changes (debounced)
	function updateSearchUrl(query: string) {
		const params = new URLSearchParams(page.url.searchParams);
		if (query.trim()) {
			params.set('q', query);
		} else {
			params.delete('q');
		}
		const itemParam = params.get('item');
		if (itemParam) {
			params.delete('item'); // Clear item selection when search changes
		}
		goto(`/search?${params}`, { replaceState: true, keepFocus: true });
		lastUrlQuery = query;
	}

	// Debounced handler for input changes
	function handleSearchInput() {
		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			debouncedQuery = searchInput;
			updateSearchUrl(searchInput);
		}, 300);
	}

	const searchResults = useQuery(api.items.search, () => ({ query: debouncedQuery }));

	// Update the current items when search results change
	$effect(() => {
		if (searchResults.data) {
			currentItemsContext.setItems(searchResults.data);
		}
	});

	// Retry handler for failed screenshots
	async function handleRetryScreenshot(itemId: Id<'items'>) {
		await client.mutation(api.screenshots.retryScreenshot, { itemId });
	}
</script>

<div class="container">
	<div class="page-header">
		<h1>search</h1>
	</div>

	<div class="search-box">
		<input
			type="text"
			bind:value={searchInput}
			oninput={handleSearchInput}
			placeholder="search items..."
			autofocus
		/>
	</div>

	{#if !debouncedQuery.trim()}
		<p class="status-text">type to search across your items</p>
	{:else if searchResults.isLoading}
		<p class="status-text">searching...</p>
	{:else if searchResults.error}
		<p>error: {searchResults.error.message}</p>
	{:else if searchResults.data?.length === 0}
		<p class="status-text">no items found for "{debouncedQuery}"</p>
	{:else}
		<p class="status-text result-count">
			{searchResults.data?.length}
			{searchResults.data?.length === 1 ? 'result' : 'results'}
		</p>
		<ItemGrid
			items={searchResults.data ?? []}
			onRetryScreenshot={handleRetryScreenshot}
		/>
	{/if}
</div>

<style>
	/* Uses global .page-header, .status-text styles from app.css */
	.search-box {
		margin-bottom: 1rem;
	}
	.search-box input {
		width: 100%;
	}
	.result-count {
		margin-bottom: 0.5rem;
	}
</style>
