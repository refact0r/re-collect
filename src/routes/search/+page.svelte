<script lang="ts">
	import { useQuery } from 'convex-svelte';
	import { api } from '../../convex/_generated/api.js';
	import ItemGrid from '$lib/components/ItemGrid.svelte';

	let searchQuery = $state('');
	const searchResults = useQuery(api.items.search, () => ({ query: searchQuery }));
</script>

<div class="container">
	<div class="page-header">
		<h1>search</h1>
	</div>

	<div class="search-box">
		<input type="text" bind:value={searchQuery} placeholder="search items by title..." autofocus />
	</div>

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
		<ItemGrid items={searchResults.data ?? []} />
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
