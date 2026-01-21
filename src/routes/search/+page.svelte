<script lang="ts">
	import { page } from '$app/state';
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
		<p>error: {searchResults.error.message}</p>
	{:else if searchResults.data?.length === 0}
		<p class="status-text">no items found for "{searchQuery}"</p>
	{:else}
		<p class="status-text result-count">
			{searchResults.data?.length}
			{searchResults.data?.length === 1 ? 'result' : 'results'}
		</p>
		<ItemGrid
			items={searchResults.data ?? []}
			onRetryScreenshot={handleRetryScreenshot}
			onDelete={handleDeleteItem}
		/>
	{/if}
</div>

<style>
	.result-count {
		margin-bottom: 0.5rem;
	}
</style>
