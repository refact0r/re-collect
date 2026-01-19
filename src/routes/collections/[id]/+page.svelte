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

	// Sort state
	type SortOption =
		| 'manual'
		| 'dateAddedNewest'
		| 'dateAddedOldest'
		| 'dateModifiedNewest'
		| 'dateModifiedOldest'
		| 'titleAsc'
		| 'titleDesc';
	let sortBy = $state<SortOption>('manual');

	// Use dedicated query for collection items with sort option
	const items = useQuery(api.items.listByCollection, () => ({ collectionId, sortBy }));

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

	// Delete handler
	async function handleDeleteItem(itemId: Id<'items'>) {
		await client.mutation(api.items.remove, { id: itemId });
	}

	let isEditing = $state(false);
	let editName = $state('');
	let inputElement: HTMLInputElement | undefined = $state();

	function startEditing() {
		if (collection.data) {
			editName = collection.data.name;
			isEditing = true;
			// Focus the input after it's rendered
			setTimeout(() => inputElement?.select(), 0);
		}
	}

	function cancelEditing() {
		isEditing = false;
		editName = '';
	}

	async function saveEdits() {
		const trimmed = editName.trim();
		if (!trimmed || trimmed === collection.data?.name) {
			cancelEditing();
			return;
		}
		await client.mutation(api.collections.update, {
			id: collectionId,
			name: trimmed
		});
		isEditing = false;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			saveEdits();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			cancelEditing();
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
		<div class="page-header">
			<h1>
				{#if isEditing}
					<input
						bind:this={inputElement}
						bind:value={editName}
						onblur={saveEdits}
						onkeydown={handleKeydown}
						class="title-input h1"
						type="text"
						placeholder="collection name"
					/>
				{:else}
					<button class="title-button h1" onclick={startEditing}>
						{collection.data.name}
					</button>
				{/if}
			</h1>
			<div class="header-controls">
				<select bind:value={sortBy}>
					<option value="manual">manual</option>
					<option value="dateAddedNewest">added (new)</option>
					<option value="dateAddedOldest">added (old)</option>
					<option value="dateModifiedNewest">modified (new)</option>
					<option value="dateModifiedOldest">modified (old)</option>
					<option value="titleAsc">title (a-z)</option>
					<option value="titleDesc">title (z-a)</option>
				</select>
			</div>
		</div>

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
				onReorder={sortBy === 'manual' ? handleReorder : undefined}
				onRetryScreenshot={handleRetryScreenshot}
				onDelete={handleDeleteItem}
			/>
		{/if}
	</div>
{/if}

<style>
	/* Uses global .page-header, .status-text styles from app.css */

	.input-wrapper {
		margin-bottom: 1rem;
	}

	.header-controls {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.page-header h1 {
		margin: 0;
		padding: 0;
		font-size: inherit;
		font-weight: inherit;
	}

	.title-button {
		all: unset;
	}

	.title-button:hover,
	.title-button:focus {
		color: var(--txt-3);
	}

	.title-input {
		all: unset;
		border: 1px solid var(--border);
		padding: 0.25rem 0.5rem;
		width: 100%;
		max-width: 600px;
	}
</style>
