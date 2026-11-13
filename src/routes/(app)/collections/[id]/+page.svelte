<script lang="ts">
	import { dev } from '$app/env';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onDestroy } from 'svelte';
	import { useConvexClient, useQuery } from 'convex-svelte';
	import { api } from '../../../../convex/_generated/api.js';
	import type { Id } from '../../../../convex/_generated/dataModel.js';
	import ItemGrid from '#lib/components/ItemGrid.svelte';
	import ItemList from '#lib/components/ItemList.svelte';
	import TopControls from '#lib/components/TopControls.svelte';
	import { type ViewMode } from '#lib/components/ViewToggle.svelte';
	import { deleteItem, mutate, retryScreenshot } from '#lib/mutationHelper.js';
	import {
		getWriteTokenContext,
		getCollectionsContext,
		getCurrentItemsContext
	} from '#lib/context.js';
	import type { CollectionSortOption } from '#lib/types.js';

	let { data } = $props();

	const client = useConvexClient();
	const getWriteToken = getWriteTokenContext();
	const token = $derived(data.writeToken ?? undefined);
	const collectionId = $derived(page.params.id as Id<'collections'>);
	const ownCollections = getCollectionsContext();
	const currentItemsContext = getCurrentItemsContext();

	// The signed-in user's own collection comes straight from the layout's list.
	// Anyone else's (and every collection, for a logged-out visitor) is fetched
	// on its own, read-only.
	const own = $derived(ownCollections.data?.find((c) => c._id === collectionId));
	const other = useQuery(
		api.collections.get,
		() => (own || ownCollections.isLoading ? 'skip' : { id: collectionId, token }),
		() => ({ initialData: data.collection ?? undefined })
	);
	const collection = $derived(own ?? other.data);
	const isOwner = $derived(!!own);
	const isLoading = $derived(ownCollections.isLoading || other.isLoading);

	// Everyone starts from the owner's saved view settings. The owner's changes
	// save to the collection; anyone else's stay on this page. A local value
	// (keyed by collection, so navigating drops it) wins until the save lands.
	type Prefs = {
		sortMode: CollectionSortOption;
		viewMode: ViewMode;
		columnOffset: number;
		showTitles: boolean;
	};
	let local = $state<{ id: string; prefs: Partial<Prefs> }>({ id: '', prefs: {} });
	const localPrefs = $derived(local.id === collectionId ? local.prefs : {});
	const sortBy = $derived(localPrefs.sortMode ?? collection?.sortMode ?? 'manual');
	const viewMode = $derived(localPrefs.viewMode ?? collection?.viewMode ?? 'grid');
	const columnOffset = $derived(localPrefs.columnOffset ?? collection?.columnOffset ?? 0);
	const showTitles = $derived(localPrefs.showTitles ?? collection?.showTitles ?? false);

	async function setPrefs(prefs: Partial<Prefs>) {
		local = { id: collectionId, prefs: { ...localPrefs, ...prefs } };
		if (!isOwner) return;
		await mutate(getWriteToken(), (t) =>
			client.mutation(api.collections.update, { id: collectionId, ...prefs, token: t })
		);
	}

	const items = useQuery(api.items.listByCollection, () => ({ collectionId, sortBy, token }));

	// Visitors search within the collection (?q=); the box writes the URL after a
	// pause, and follows it when something else changes it (a tag link, back)
	const query = $derived(page.url.searchParams.get('q')?.trim() ?? '');
	const results = useQuery(
		api.items.searchCollection,
		() => (query ? { collectionId, query, token } : 'skip'),
		{ keepPreviousData: true }
	);
	let searchInput = $derived(query);
	let searchTimer: ReturnType<typeof setTimeout> | undefined;
	onDestroy(() => clearTimeout(searchTimer));
	function handleQueryChange(value: string) {
		searchInput = value;
		clearTimeout(searchTimer);
		searchTimer = setTimeout(() => {
			const url = new URL(page.url.href);
			if (value.trim()) url.searchParams.set('q', value.trim());
			else url.searchParams.delete('q');
			url.searchParams.delete('item');
			goto(url, { replace: true, reset: false });
		}, 300);
	}

	const shown = $derived(query ? results : items);

	// Update the current items when data changes
	$effect(() => {
		if (shown.data) {
			currentItemsContext.setItems(shown.data);
		}
	});

	// Reorder handler for drag-drop; optimistic so the grid doesn't snap back before the server responds
	async function handleReorder(itemId: Id<'items'>, newPosition: string) {
		// Must match the useQuery args exactly, token included, to hit its cache entry
		const queryArgs = { collectionId, sortBy, token };
		await mutate(getWriteToken(), (t) =>
			client.mutation(
				api.itemCollectionPositions.reorderItem,
				{ itemId, collectionId, newPosition, token: t },
				{
					optimisticUpdate: (store) => {
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
			)
		);
	}

	const handleRetryScreenshot = (itemId: Id<'items'>) =>
		retryScreenshot(client, getWriteToken(), itemId);
	const handleDelete = (itemId: Id<'items'>) => deleteItem(client, getWriteToken(), itemId);

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
		const result = await mutate(getWriteToken(), (t) =>
			client.mutation(api.collections.update, {
				id: collectionId,
				name: trimmed,
				token: t
			})
		);
		if (result !== null) {
			isEditing = false;
		}
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

<svelte:head>
	{#if collection}
		<title>{dev ? 'DEV ' : ''}{collection.name} · re-collect</title>
	{/if}
	<!-- Link previews; only logged-out requests (crawlers included) load these -->
	{#if data.collection}
		<meta property="og:title" content={data.collection.name} />
		<meta property="og:description" content="a collection by {data.collection.owner}" />
		<meta property="og:site_name" content="re-collect" />
		{#if data.collection.coverUrl}
			<meta property="og:image" content={data.collection.coverUrl} />
			<meta name="twitter:card" content="summary_large_image" />
		{/if}
	{/if}
</svelte:head>

{#if isLoading}
	<p class="status-text">loading...</p>
{:else if other.error}
	<p class="status-text">error: {other.error.message}</p>
{:else if !collection}
	<p class="status-text">collection not found</p>
{:else}
	<div class="container">
		<h1>
			{#if !isOwner}
				{collection.name}
				<span class="byline">by {other.data?.owner}</span>
			{:else if isEditing}
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
					{collection.name}
				</button>
			{/if}
		</h1>

		<TopControls
			{collectionId}
			{sortBy}
			{viewMode}
			{columnOffset}
			{showTitles}
			showManualSort={true}
			readonly={!isOwner}
			query={searchInput}
			onQueryChange={handleQueryChange}
			onSortChange={(sortMode) => setPrefs({ sortMode })}
			onViewModeChange={(viewMode) => setPrefs({ viewMode })}
			onColumnOffsetChange={(columnOffset) => setPrefs({ columnOffset })}
			onShowTitlesChange={(showTitles) => setPrefs({ showTitles })}
		/>

		{#if shown.isLoading}
			<p class="status-text">loading items...</p>
		{:else if shown.data?.length === 0}
			<p class="status-text">{query ? 'no matches.' : 'no items in this collection yet.'}</p>
		{:else if viewMode === 'list'}
			<ItemList items={shown.data ?? []} onDelete={isOwner ? handleDelete : undefined} />
		{:else}
			<ItemGrid
				items={shown.data ?? []}
				{columnOffset}
				{showTitles}
				onReorder={isOwner && sortBy === 'manual' && !query ? handleReorder : undefined}
				onRetryScreenshot={isOwner ? handleRetryScreenshot : undefined}
				onDelete={isOwner ? handleDelete : undefined}
			/>
		{/if}
	</div>
{/if}

<style>
	h1 {
		margin: 0 0 var(--spacing) 0;
		padding: 0;
		font-size: inherit;
		font-weight: inherit;
	}

	.byline {
		color: var(--txt-3);
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
