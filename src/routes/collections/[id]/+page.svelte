<script lang="ts">
	import { page } from '$app/stores';
	import { useQuery, useConvexClient } from 'convex-svelte';
	import { api } from '../../../convex/_generated/api.js';
	import type { Id } from '../../../convex/_generated/dataModel.js';

	const client = useConvexClient();
	const collectionId = $derived($page.params.id as Id<'collections'>);
	const collection = useQuery(api.collections.get, () => ({ id: collectionId }));
	const items = useQuery(api.items.listByCollection, () => ({ collectionId }));

	async function handleRemoveFromCollection(itemId: Id<'items'>) {
		await client.mutation(api.items.removeFromCollection, { itemId, collectionId });
	}

	async function handleDelete(id: Id<'items'>) {
		if (confirm('Delete this item completely?')) {
			await client.mutation(api.items.remove, { id });
		}
	}
</script>

{#if collection.isLoading}
	<p>Loading...</p>
{:else if collection.error}
	<p>Error: {collection.error.message}</p>
{:else if !collection.data}
	<p>Collection not found</p>
{:else}
	<div class="container">
		<div class="header">
			<h1>{collection.data.name}</h1>
			{#if collection.data.description}
				<p class="description">{collection.data.description}</p>
			{/if}
			<a href="/collections/{collectionId}/edit">Edit collection</a>
		</div>

		{#if items.isLoading}
			<p>Loading items...</p>
		{:else if items.data?.length === 0}
			<p>No items in this collection yet.</p>
		{:else}
			<div class="grid">
				{#each items.data ?? [] as item (item._id)}
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
							<button onclick={() => handleRemoveFromCollection(item._id)}>remove</button>
							<button onclick={() => handleDelete(item._id)}>delete</button>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>
{/if}

<style>
	.container {
		max-width: 1200px;
		margin: 0 auto;
	}
	.header {
		margin-bottom: 2rem;
	}
	.description {
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
