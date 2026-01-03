<script lang="ts">
	import { useQuery, useConvexClient } from 'convex-svelte';
	import { api } from '../../convex/_generated/api.js';
	import type { Id } from '../../convex/_generated/dataModel.js';

	const client = useConvexClient();
	let searchQuery = $state('');
	const searchResults = useQuery(api.items.search, () => ({ query: searchQuery }));

	async function handleDelete(id: Id<'items'>) {
		if (confirm('Delete this item?')) {
			await client.mutation(api.items.remove, { id });
		}
	}
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
		<div class="grid">
			{#each searchResults.data ?? [] as item (item._id)}
				<div class="card">
					{#if item.type === 'image' && item.imageUrl}
						<img src={item.imageUrl} alt={item.title ?? 'Image'} />
					{:else if item.type === 'url'}
						<div class="url-card">
							<a href={item.url} target="_blank" rel="noopener">{item.url}</a>
						</div>
					{:else if item.type === 'text'}
						<div class="text-card">
							<p>{item.content}</p>
						</div>
					{/if}
					{#if item.title}
						<div class="card-title">{item.title}</div>
					{/if}
					<div class="card-actions">
						<a href="/item/{item._id}">edit</a>
						<button onclick={() => handleDelete(item._id)}>delete</button>
					</div>
				</div>
			{/each}
		</div>
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
		border: 1px solid #ddd;
	}
	.hint {
		color: #666;
	}
	.result-count {
		margin-bottom: 1rem;
		color: #666;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
		gap: 1rem;
	}
	.card {
		border: 1px solid #ddd;
		padding: 0.5rem;
	}
	.card img {
		width: 100%;
		display: block;
	}
	.url-card,
	.text-card {
		padding: 1rem;
		background: #f9f9f9;
		word-break: break-all;
	}
	.card-title {
		padding: 0.5rem 0;
		font-size: 0.875rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.card-actions {
		display: flex;
		gap: 0.5rem;
		font-size: 0.875rem;
	}
	.card-actions button {
		background: none;
		border: none;
		padding: 0;
		text-decoration: underline;
		cursor: pointer;
		font-size: inherit;
	}
</style>
