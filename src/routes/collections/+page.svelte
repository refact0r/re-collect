<script lang="ts">
	import { useQuery, useConvexClient } from 'convex-svelte';
	import { api } from '../../convex/_generated/api.js';
	import type { Id } from '../../convex/_generated/dataModel.js';

	const client = useConvexClient();
	const collections = useQuery(api.collections.listWithCounts, {});

	let newName = $state('');
	let newDescription = $state('');
	let isCreating = $state(false);

	async function handleCreate() {
		if (!newName.trim()) return;

		isCreating = true;
		try {
			await client.mutation(api.collections.create, {
				name: newName.trim(),
				description: newDescription.trim() || undefined
			});
			newName = '';
			newDescription = '';
		} finally {
			isCreating = false;
		}
	}

	async function handleDelete(id: Id<'collections'>) {
		if (confirm('Delete this collection? Items will not be deleted.')) {
			await client.mutation(api.collections.remove, { id });
		}
	}
</script>

<div class="container">
	<h1>Collections</h1>

	<div class="create-form">
		<h2>Create New Collection</h2>
		<input type="text" bind:value={newName} placeholder="Collection name" disabled={isCreating} />
		<input
			type="text"
			bind:value={newDescription}
			placeholder="Description (optional)"
			disabled={isCreating}
		/>
		<button onclick={handleCreate} disabled={isCreating || !newName.trim()}>Create</button>
	</div>

	{#if collections.isLoading}
		<p>Loading...</p>
	{:else if collections.error}
		<p>Error: {collections.error.message}</p>
	{:else if collections.data?.length === 0}
		<p>No collections yet. Create your first one above!</p>
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
						<a href="/collections/{collection._id}/edit">edit</a>
						<button onclick={() => handleDelete(collection._id)}>delete</button>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.container {
		max-width: 800px;
	}
	.create-form {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-bottom: 2rem;
		padding: 1rem;
		border: 1px solid #ddd;
	}
	.create-form h2 {
		margin-bottom: 0.5rem;
	}
	input {
		padding: 0.5rem;
		font-size: 1rem;
	}
	button {
		padding: 0.5rem 1rem;
		align-self: flex-start;
	}
	.list {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.collection-card {
		border: 1px solid #ddd;
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
		color: #666;
		margin: 0.25rem 0;
	}
	.count {
		font-size: 0.875rem;
		color: #999;
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
