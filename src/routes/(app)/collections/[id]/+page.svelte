<script lang="ts">
	import { page } from '$app/state';
	import { api } from '../../../../convex/_generated/api.js';
	import type { Id } from '../../../../convex/_generated/dataModel.js';
	import ItemsView from '#lib/components/ItemsView.svelte';
	import TopControls from '#lib/components/TopControls.svelte';
	import { useMutation, useQuery } from '#lib/convex.js';
	import { getCollectionsContext } from '#lib/context.js';
	import { useCollectionPrefs } from '#lib/prefs.svelte.js';

	const mutate = useMutation();
	const collections = getCollectionsContext();
	const collectionId = $derived(page.params.id as Id<'collections'>);
	const collection = $derived(collections.data?.find((c) => c._id === collectionId));
	const prefs = useCollectionPrefs(() => collectionId);

	// Waits for the collection's saved sort. The previous list stays up while a new
	// sort loads, but never under another collection's header.
	let shownId = $state<Id<'collections'>>();
	const items = useQuery(
		api.items.listByCollection,
		() => (prefs.loaded ? { collectionId, sortBy: prefs.sortBy } : 'skip'),
		() => ({ keepPreviousData: shownId === collectionId })
	);
	$effect(() => {
		if (items.data && !items.isStale) shownId = collectionId;
	});

	// Reorder handler for drag-drop; optimistic so the grid doesn't snap back before the server responds
	function handleReorder(itemId: Id<'items'>, newPosition: string) {
		mutate(
			api.itemCollectionPositions.reorderItem,
			{ itemId, collectionId, newPosition },
			{
				optimisticUpdate: (store, { token }) => {
					// Must match the useQuery args exactly, token included, to hit its cache entry
					const queryArgs = { collectionId, sortBy: prefs.sortBy, token };
					const current = store.getQuery(api.items.listByCollection, queryArgs);
					if (!current) return;
					const updated = current
						.map((i) => (i._id === itemId ? { ...i, position: newPosition } : i))
						.sort((a, b) => {
							const posA = a.position ?? '￿';
							const posB = b.position ?? '￿';
							return posA < posB ? -1 : posA > posB ? 1 : 0;
						});
					store.setQuery(api.items.listByCollection, queryArgs, updated);
				}
			}
		);
	}

	let isEditing = $state(false);
	let editName = $state('');
	let inputElement: HTMLInputElement | undefined = $state();

	function startEditing() {
		if (collection) {
			editName = collection.name;
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
		if (!trimmed || trimmed === collection?.name) {
			cancelEditing();
			return;
		}
		const saved = await mutate(api.collections.update, { id: collectionId, name: trimmed });
		if (saved !== undefined) isEditing = false;
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

{#if collections.isLoading}
	<p class="status-text">loading...</p>
{:else if collections.error}
	<p class="status-text">error: {collections.error.message}</p>
{:else if !collection}
	<p class="status-text">collection not found</p>
{:else}
	<h1>
		{#if isEditing}
			<input
				bind:this={inputElement}
				bind:value={editName}
				onblur={saveEdits}
				onkeydown={handleKeydown}
				class="title-input"
				type="text"
				placeholder="collection name"
			/>
		{:else}
			<button class="title-button" onclick={startEditing}>
				{collection.name}
			</button>
		{/if}
	</h1>

	<TopControls {collectionId} {prefs} />
	<ItemsView
		{items}
		{prefs}
		loading="loading items..."
		empty="no items in this collection yet."
		onReorder={prefs.sortBy === 'manual' ? handleReorder : undefined}
	/>
{/if}

<style>
	h1 {
		margin: 0 0 var(--spacing) 0;
		padding: 0;
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
