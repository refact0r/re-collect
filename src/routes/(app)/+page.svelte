<script lang="ts">
	import { getContext, untrack } from 'svelte';
	import { useConvexClient, useQuery } from 'convex-svelte';
	import { api } from '../../convex/_generated/api.js';
	import type { Id } from '../../convex/_generated/dataModel.js';
	import ItemGrid from '$lib/components/ItemGrid.svelte';
	import ItemList from '$lib/components/ItemList.svelte';
	import TopControls from '$lib/components/TopControls.svelte';
	import { type ViewMode } from '$lib/components/ViewToggle.svelte';
	import { mutate } from '$lib/mutationHelper.js';
	import { SvelteSet } from 'svelte/reactivity';

	const client = useConvexClient();
	const writeToken = getContext<string | null>('writeToken');
	const collectionsQuery = getContext<ReturnType<typeof useQuery>>('collections');
	const currentItemsContext = getContext<{
		items: any[];
		setItems: (items: any[]) => void;
	}>('currentItems');

	// Sort state
	type SortOption =
		| 'dateAddedNewest'
		| 'dateAddedOldest'
		| 'dateModifiedNewest'
		| 'dateModifiedOldest'
		| 'titleAsc'
		| 'titleDesc';

	let sortBy = $state<SortOption>('dateAddedNewest');
	let viewMode = $state<ViewMode>('grid');
	let filterCollectionIds = $state(new SvelteSet<Id<'collections'>>());
	let prefsInitialized = $state(false);

	// Load saved preferences
	const savedPrefs = useQuery(api.viewPreferences.get, () => ({ key: 'home' }));

	// Initialize preferences from DB once loaded
	$effect(() => {
		const prefs = savedPrefs.data;
		const collections = collectionsQuery.data;
		if (prefs !== undefined && collections && !prefsInitialized) {
			untrack(() => {
				if (prefs) {
					sortBy = (prefs.sortMode as SortOption) ?? 'dateAddedNewest';
					viewMode = (prefs.viewMode as ViewMode) ?? 'grid';
					if (prefs.filterCollectionIds && prefs.filterCollectionIds.length > 0) {
						filterCollectionIds = new SvelteSet(prefs.filterCollectionIds as Id<'collections'>[]);
					} else {
						filterCollectionIds = new SvelteSet(collections.map((c: { _id: Id<'collections'> }) => c._id));
					}
				} else {
					filterCollectionIds = new SvelteSet(collections.map((c: { _id: Id<'collections'> }) => c._id));
				}
				prefsInitialized = true;
			});
		}
	});

	function handleSortChange(newSort: string) {
		sortBy = newSort as SortOption;
		if (prefsInitialized) {
			mutate(writeToken, (token) =>
				client.mutation(api.viewPreferences.set, { key: 'home', sortMode: sortBy, token })
			);
		}
	}

	function handleViewModeChange(newMode: ViewMode) {
		viewMode = newMode;
		if (prefsInitialized) {
			mutate(writeToken, (token) =>
				client.mutation(api.viewPreferences.set, { key: 'home', viewMode: newMode, token })
			);
		}
	}

	function handleFilterChange(selected: Set<Id<'collections'>>) {
		filterCollectionIds = new SvelteSet(selected);
		if (prefsInitialized) {
			const allSelected =
				collectionsQuery.data && selected.size === collectionsQuery.data.length;
			mutate(writeToken, (token) =>
				client.mutation(api.viewPreferences.set, {
					key: 'home',
					filterCollectionIds: allSelected ? [] : [...selected],
					token
				})
			);
		}
	}

	// Pass collectionIds to query only when not all collections are selected
	const allSelected = $derived(
		!collectionsQuery.data || filterCollectionIds.size === collectionsQuery.data.length
	);

	// Use query with sort option and optional collection filter
	const items = useQuery(api.items.list, () => ({
		sortBy,
		...(!allSelected ? { collectionIds: [...filterCollectionIds] } : {})
	}));

	// Update the current items when data changes
	$effect(() => {
		if (items.data) {
			currentItemsContext.setItems(items.data);
		}
	});

	async function handleRetryScreenshot(itemId: Id<'items'>) {
		await mutate(writeToken, (token) =>
			client.mutation(api.screenshots.retryScreenshot, { itemId, token })
		);
	}
</script>

<div class="container">
	<TopControls
		{sortBy}
		{viewMode}
		onSortChange={handleSortChange}
		onViewModeChange={handleViewModeChange}
		collections={collectionsQuery.data ?? []}
		{filterCollectionIds}
		onFilterChange={handleFilterChange}
	/>

	{#if items.isLoading}
		<p class="status-text">loading...</p>
	{:else if items.error}
		<p class="status-text">error: {items.error.message}</p>
	{:else if items.data?.length === 0}
		<p class="status-text">no items yet. add your first one above!</p>
	{:else if viewMode === 'list'}
		<ItemList items={items.data ?? []} onRetryScreenshot={handleRetryScreenshot} />
	{:else}
		<ItemGrid items={items.data ?? []} onRetryScreenshot={handleRetryScreenshot} />
	{/if}
</div>
