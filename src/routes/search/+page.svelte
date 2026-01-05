<script lang="ts">
	import { useQuery } from 'convex-svelte';
	import { api } from '../../convex/_generated/api.js';
	import ItemGrid from '$lib/components/ItemGrid.svelte';

	let searchQuery = $state('');
	const searchResults = useQuery(api.items.search, () => ({ query: searchQuery }));
</script>

<div class="container">
	<h1>Search</h1>

	<div class="search-box">
		<input
			type="text"
			bind:value={searchQuery}
			placeholder="Search items by title..."
			autofocus
		/>
	</div>

	{#if !searchQuery.trim()}
		<p class="hint">Type to search across your items</p>
	{:else if searchResults.isLoading}
		<p>Searching...</p>
	{:else if searchResults.error}
		<p>Error: {searchResults.error.message}</p>
	{:else if searchResults.data?.length === 0}
		<p>No items found for "{searchQuery}"</p>
	{:else}
		<p class="result-count">{searchResults.data?.length} result(s)</p>
		<ItemGrid items={searchResults.data ?? []} />
	{/if}
</div>

<style>
	.container {
		max-width: 1200px;
		margin: 0 auto;
	}
	.search-box {
		margin-bottom: 1rem;
	}
	.search-box input {
		width: 100%;
		padding: 0.75rem;
		font-size: 1rem;
	}
	.hint {
		color: var(--txt-3);
	}
	.result-count {
		margin-bottom: 1rem;
		color: var(--txt-3);
	}
</style>
