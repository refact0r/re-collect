<script lang="ts">
	import { useConvexClient, useQuery } from 'convex-svelte';
	import { api } from '../../convex/_generated/api.js';
	import type { Id } from '../../convex/_generated/dataModel.js';
	import ItemGrid from '$lib/components/ItemGrid.svelte';
	import ItemList from '$lib/components/ItemList.svelte';
	import TopControls from '$lib/components/TopControls.svelte';
	import { type ViewMode } from '$lib/components/ViewToggle.svelte';
	import { mutate, retryScreenshot } from '$lib/mutationHelper.js';
	import { SvelteSet } from 'svelte/reactivity';
	import {
		getWriteTokenContext,
		getCollectionsContext,
		getCurrentItemsContext
	} from '$lib/context.js';
	import type { CollectionSortOption, SortOption } from '$lib/types.js';

	const client = useConvexClient();
	const getWriteToken = getWriteTokenContext();
	const writeToken = $derived(getWriteToken());
	const collectionsQuery = getCollectionsContext();
	const currentItemsContext = getCurrentItemsContext();

	const UNCOLLECTED = 'uncollected';

	// Load saved preferences; local overrides win until the mutation round-trips
	const savedPrefs = useQuery(api.viewPreferences.get, () => ({ key: 'home' }));
	let sortOverride = $state<SortOption | null>(null);
	let viewOverride = $state<ViewMode | null>(null);
	const sortBy = $derived(sortOverride ?? savedPrefs.data?.sortMode ?? 'dateAddedNewest');
	const viewMode = $derived(viewOverride ?? savedPrefs.data?.viewMode ?? 'grid');

	// The filter set needs both prefs and collections loaded, so it's initialized once
	let filterCollectionIds = $state.raw(new SvelteSet<string>());
	let filterInitialized = $state(false);

	$effect(() => {
		const prefs = savedPrefs.data;
		const collections = collectionsQuery.data;
		if (prefs !== undefined && collections && !filterInitialized) {
			if (prefs?.filterCollectionIds && prefs.filterCollectionIds.length > 0) {
				const saved: string[] = [...prefs.filterCollectionIds];
				if (prefs.includeUncollected !== false) saved.push(UNCOLLECTED);
				filterCollectionIds = new SvelteSet(saved);
			} else {
				filterCollectionIds = new SvelteSet([...collections.map((c) => c._id), UNCOLLECTED]);
			}
			filterInitialized = true;
		}
	});

	function handleSortChange(newSort: CollectionSortOption) {
		const sort = newSort as SortOption; // 'manual' is not offered on the home page
		sortOverride = sort;
		mutate(writeToken, (token) =>
			client.mutation(api.viewPreferences.set, { key: 'home', sortMode: sort, token })
		);
	}

	function handleViewModeChange(newMode: ViewMode) {
		viewOverride = newMode;
		mutate(writeToken, (token) =>
			client.mutation(api.viewPreferences.set, { key: 'home', viewMode: newMode, token })
		);
	}

	function handleFilterChange(selected: Set<string>) {
		filterCollectionIds = new SvelteSet(selected);
		if (filterInitialized) {
			const collectionOnly = [...selected].filter((id) => id !== UNCOLLECTED);
			const includeUncollected = selected.has(UNCOLLECTED);
			const totalOptions = (collectionsQuery.data?.length ?? 0) + 1;
			const allSelected = selected.size === totalOptions;
			mutate(writeToken, (token) =>
				client.mutation(api.viewPreferences.set, {
					key: 'home',
					filterCollectionIds: allSelected ? [] : (collectionOnly as Id<'collections'>[]),
					includeUncollected,
					token
				})
			);
		}
	}

	// Pass collectionIds to query only when not all options are selected
	const totalOptions = $derived((collectionsQuery.data?.length ?? 0) + 1);
	const allSelected = $derived(!collectionsQuery.data || filterCollectionIds.size === totalOptions);

	// Split sentinel from real collection IDs for the query
	const queryCollectionIds = $derived(
		[...filterCollectionIds].filter((id) => id !== UNCOLLECTED) as Id<'collections'>[]
	);
	const includeUncollected = $derived(filterCollectionIds.has(UNCOLLECTED));

	// Use query with sort option and optional collection filter
	const items = useQuery(api.items.list, () => ({
		sortBy,
		...(!allSelected ? { collectionIds: queryCollectionIds, includeUncollected } : {})
	}));

	// Update the current items when data changes
	$effect(() => {
		if (items.data) {
			currentItemsContext.setItems(items.data);
		}
	});

	const handleRetryScreenshot = (itemId: Id<'items'>) =>
		retryScreenshot(client, writeToken, itemId);
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
		<ItemList items={items.data ?? []} />
	{:else}
		<ItemGrid items={items.data ?? []} onRetryScreenshot={handleRetryScreenshot} />
	{/if}
</div>
