<script lang="ts">
	import { page } from '$app/state';
	import { useQuery, useConvexClient } from 'convex-svelte';
	import { api } from '../../../convex/_generated/api.js';
	import type { Id } from '../../../convex/_generated/dataModel.js';
	import ItemGrid from '$lib/components/ItemGrid.svelte';

	const client = useConvexClient();
	const collectionId = $derived(page.params.id as Id<'collections'>);
	const collection = useQuery(api.collections.get, () => ({ id: collectionId }));
	const items = useQuery(api.items.listByCollection, () => ({ collectionId }));

	let isEditing = $state(false);
	let editName = $state('');
	let editDescription = $state('');

	function startEditing() {
		if (collection.data) {
			editName = collection.data.name;
			editDescription = collection.data.description ?? '';
			isEditing = true;
		}
	}

	function cancelEditing() {
		isEditing = false;
	}

	async function saveEdits() {
		if (!editName.trim()) return;
		await client.mutation(api.collections.update, {
			id: collectionId,
			name: editName.trim(),
			description: editDescription.trim() || undefined
		});
		isEditing = false;
	}

	async function handleDeleteCollection() {
		if (confirm('Delete this collection? Items will not be deleted.')) {
			await client.mutation(api.collections.remove, { id: collectionId });
			window.location.href = '/collections';
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
			{#if isEditing}
				<div class="edit-form">
					<input type="text" bind:value={editName} placeholder="Collection name" />
					<textarea bind:value={editDescription} rows="2" placeholder="Description (optional)"></textarea>
					<div class="edit-actions">
						<button onclick={saveEdits} disabled={!editName.trim()}>Save</button>
						<button onclick={cancelEditing}>Cancel</button>
					</div>
				</div>
			{:else}
				<h1>{collection.data.name}</h1>
				{#if collection.data.description}
					<p class="description">{collection.data.description}</p>
				{/if}
				<div class="header-actions">
					<button onclick={startEditing}>Edit</button>
					<button onclick={handleDeleteCollection} class="danger">Delete collection</button>
				</div>
			{/if}
		</div>

		{#if items.isLoading}
			<p>Loading items...</p>
		{:else if items.data?.length === 0}
			<p>No items in this collection yet.</p>
		{:else}
			<ItemGrid items={items.data ?? []} />
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
		color: var(--txt-3);
		margin: 0.5rem 0;
	}
	.header-actions {
		display: flex;
		gap: 0.5rem;
		margin-top: 1rem;
	}
	.edit-form {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		max-width: 600px;
	}
	.edit-actions {
		display: flex;
		gap: 0.5rem;
	}
</style>
