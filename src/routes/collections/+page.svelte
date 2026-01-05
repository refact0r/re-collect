<script lang="ts">
	import { useQuery, useConvexClient } from 'convex-svelte';
	import { api } from '../../convex/_generated/api.js';
	import type { Id } from '../../convex/_generated/dataModel.js';
	import CollectionCreateModal from '$lib/components/CollectionCreateModal.svelte';

	const client = useConvexClient();
	const collections = useQuery(api.collections.listWithCounts, {});

	let showCreateModal = $state(false);

	async function handleDelete(id: Id<'collections'>) {
		if (confirm('Delete this collection? Items will not be deleted.')) {
			await client.mutation(api.collections.remove, { id });
		}
	}
</script>

<div class="container">
	<div class="header">
		<h1>Collections</h1>
		<button onclick={() => (showCreateModal = true)}>New Collection</button>
	</div>

	{#if collections.isLoading}
		<p>Loading...</p>
	{:else if collections.error}
		<p>Error: {collections.error.message}</p>
	{:else if collections.data?.length === 0}
		<p>No collections yet. Click "New Collection" to create your first one!</p>
	{:else}
		<div class="list">
			{#each collections.data ?? [] as collection (collection._id)}
				<div class="collection-card">
					<a href="/collections/{collection._id}" class="collection-link">
						<h3>{collection.name}</h3>
						{#if collection.description}
							<p class="description">{collection.description}</p>
						{/if}
						<p class="count">{collection.itemCount} items</p>
					</a>
					<div class="actions">
						<button onclick={() => handleDelete(collection._id)}>delete</button>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

{#if showCreateModal}
	<CollectionCreateModal onClose={() => (showCreateModal = false)} />
{/if}

<style>
	.container {
		max-width: 800px;
	}
	.header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 2rem;
	}
	.header h1 {
		margin: 0;
	}
	.list {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.collection-card {
		border: 1px solid var(--border);
		padding: 1rem;
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
	}
	.collection-link {
		text-decoration: none;
		flex: 1;
	}
	.collection-link h3 {
		margin: 0;
	}
	.description {
		color: var(--txt-3);
		margin: 0.25rem 0;
	}
	.count {
		font-size: 0.875rem;
		color: var(--txt-3);
		margin: 0;
	}
	.actions {
		display: flex;
		gap: 0.5rem;
		font-size: 0.875rem;
	}
	.actions button {
		background: none;
		border: none;
		padding: 0;
		text-decoration: underline;
		cursor: pointer;
		font-size: inherit;
	}
</style>
