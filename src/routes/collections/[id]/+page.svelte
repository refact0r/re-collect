<script lang="ts">
	import { page } from '$app/state';
	import { getContext } from 'svelte';
	import { useConvexClient, useQuery } from 'convex-svelte';
	import { api } from '../../../convex/_generated/api.js';
	import type { Id } from '../../../convex/_generated/dataModel.js';
	import ItemGrid from '$lib/components/ItemGrid.svelte';
	import ItemInput from '$lib/components/ItemInput.svelte';

	const client = useConvexClient();
	const collectionId = $derived(page.params.id as Id<'collections'>);
	const allCollections =
		getContext<ReturnType<typeof import('convex-svelte').useQuery>>('collections');
	const currentItemsContext = getContext<{
		items: any[];
		setItems: (items: any[]) => void;
	}>('currentItems');

	// Use dedicated query for collection items (ordered by position)
	const items = useQuery(api.items.listByCollection, () => ({ collectionId }));

	// Update the current items when data changes
	$effect(() => {
		if (items.data) {
			currentItemsContext.setItems(items.data);
		}
	});

	// Derive collection from context
	const collection = $derived.by(() => {
		if (allCollections.isLoading || allCollections.error || !allCollections.data) {
			return { isLoading: allCollections.isLoading, error: allCollections.error, data: null };
		}
		return {
			isLoading: false,
			error: null,
			data: allCollections.data.find((c: any) => c._id === collectionId) ?? null
		};
	});

	// Reorder handler for drag-drop
	async function handleReorder(itemId: Id<'items'>, newPosition: string) {
		await client.mutation(api.itemCollectionPositions.reorderItem, {
			itemId,
			collectionId,
			newPosition
		});
	}

	// Retry handler for failed screenshots
	async function handleRetryScreenshot(itemId: Id<'items'>) {
		await client.mutation(api.screenshots.retryScreenshot, { itemId });
	}

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
	<p>loading...</p>
{:else if collection.error}
	<p>error: {collection.error.message}</p>
{:else if !collection.data}
	<p>collection not found</p>
{:else}
	<div class="container">
		<header>
			{#if isEditing}
				<div class="form edit-form">
					<input type="text" bind:value={editName} placeholder="collection name" />
					<textarea bind:value={editDescription} rows="2" placeholder="description (optional)"
					></textarea>
					<div class="actions">
						<button onclick={saveEdits} disabled={!editName.trim()}>save</button>
						<button onclick={cancelEditing}>cancel</button>
					</div>
				</div>
			{:else}
				<h1>{collection.data.name}</h1>
				{#if collection.data.description}
					<p class="description">{collection.data.description}</p>
				{/if}
				<div class="actions">
					<button onclick={startEditing}>edit</button>
					<button onclick={handleDeleteCollection} class="danger">delete</button>
				</div>
			{/if}
		</header>

		<div class="input-wrapper">
			<ItemInput {collectionId} />
		</div>

		{#if items.isLoading}
			<p class="status-text">loading items...</p>
		{:else if items.data?.length === 0}
			<p class="status-text">no items in this collection yet.</p>
		{:else}
			<ItemGrid
				items={items.data ?? []}
				{collectionId}
				onReorder={handleReorder}
				onRetryScreenshot={handleRetryScreenshot}
			/>
		{/if}
	</div>
{/if}

<style>
	/* Uses global .form, .actions, .status-text styles from app.css */
	header {
		margin-bottom: 2rem;
	}
	.description {
		color: var(--txt-3);
		margin: 0.5rem 0;
	}
	.actions {
		margin-top: 1rem;
		display: flex;
		gap: 0.5rem;
	}
	.input-wrapper {
		margin-bottom: 1rem;
	}
</style>
