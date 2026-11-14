<script lang="ts">
	import { page } from '$app/state';
	import { beforeNavigate, goto } from '$app/navigation';
	import { api } from '../../../../convex/_generated/api.js';
	import type { Id } from '../../../../convex/_generated/dataModel.js';
	import ItemsView from '#lib/components/ItemsView.svelte';
	import TopControls from '#lib/components/TopControls.svelte';
	import { useMutation, useQuery } from '#lib/convex.js';
	import { getCollectionsContext } from '#lib/context.js';
	import { pageTitle } from '#lib/pageTitle.svelte.js';
	import { useCollectionPrefs, useLocalPrefs } from '#lib/prefs.svelte.js';

	let { data } = $props();

	const mutate = useMutation();
	const ownCollections = getCollectionsContext();
	const collectionId = $derived(page.params.id as Id<'collections'>);

	// The signed-in user's own collection comes straight from the layout's list.
	// Anyone else's (and every collection, for a logged-out visitor) is fetched
	// on its own, read-only.
	const own = $derived(ownCollections.data?.find((c) => c._id === collectionId));
	const other = useQuery(
		api.collections.get,
		() => (own || ownCollections.isLoading ? 'skip' : { id: collectionId }),
		() => ({ initialData: data.collection ?? undefined })
	);
	const collection = $derived(own ?? other.data);
	const isOwner = $derived(!!own);
	const isLoading = $derived(ownCollections.isLoading || other.isLoading);
	const error = $derived(ownCollections.error ?? other.error);

	$effect(() => {
		pageTitle.value = collection?.name ?? null;
		return () => (pageTitle.value = null);
	});

	// Everyone starts from the owner's saved view settings; the owner's changes
	// save to the collection, anyone else's stay on this page
	const ownerPrefs = useCollectionPrefs(() => collectionId);
	const visitorPrefs = useLocalPrefs(
		() => collectionId,
		() => other.data
	);
	const prefs = $derived(isOwner ? ownerPrefs : visitorPrefs);

	// Waits for the collection (and so its saved sort), so a malformed or private
	// id never reaches the id-validated item queries. The previous list stays up
	// while a new sort loads, but never under another collection's header.
	let shownId = $state<Id<'collections'>>();
	const items = useQuery(
		api.items.listByCollection,
		() => (collection ? { collectionId, sortBy: prefs.sortBy } : 'skip'),
		() => ({ keepPreviousData: shownId === collectionId })
	);
	$effect(() => {
		if (items.data && !items.isStale) shownId = collectionId;
	});

	// Visitors search within the collection (?q=); the box writes the URL after a
	// pause, and follows it when something else changes it (a tag link, back).
	// The owner has no box (their tag links go to /search), so ignores it.
	const query = $derived(isOwner ? '' : (page.url.searchParams.get('q')?.trim() ?? ''));
	const results = useQuery(
		api.items.searchCollection,
		() => (collection && query ? { collectionId, query } : 'skip'),
		{ keepPreviousData: true }
	);
	let searchInput = $derived(query);
	let searchTimer: ReturnType<typeof setTimeout> | undefined;
	// A pending search update would close a just-opened item
	beforeNavigate(() => clearTimeout(searchTimer));
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

<svelte:head>
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
{:else if error}
	<p class="status-text">error: {error.message}</p>
{:else if !collection}
	<p class="status-text">collection not found</p>
{:else}
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

	<TopControls
		{collectionId}
		{prefs}
		readonly={!isOwner}
		query={searchInput}
		onQueryChange={handleQueryChange}
	/>
	<ItemsView
		items={query ? results : items}
		{prefs}
		loading="loading items..."
		empty={query ? 'no matches.' : 'no items in this collection yet.'}
		onReorder={isOwner && prefs.sortBy === 'manual' ? handleReorder : undefined}
		readonly={!isOwner}
	/>
{/if}

<style>
	h1 {
		margin: 0 0 var(--spacing) 0;
		padding: 0;
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
