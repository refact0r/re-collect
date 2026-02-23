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
	const getWriteToken = getContext<() => string | null>('writeToken');
	const writeToken = $derived(getWriteToken());
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

	const UNCOLLECTED = 'uncollected';

	let sortBy = $state<SortOption>('dateAddedNewest');
	let viewMode = $state<ViewMode>('grid');
	let filterCollectionIds = $state(new SvelteSet<string>());
	let prefsInitialized = $state(false);

	// Load saved preferences
	const savedPrefs = useQuery(api.viewPreferences.get, () => ({ key: 'home' }));

	// Initialize preferences from DB once loaded
	$effect(() => {
		const prefs = savedPrefs.data;
		const collections = collectionsQuery.data;
		if (prefs !== undefined && collections && !prefsInitialized) {
			untrack(() => {
				const allIds: string[] = [
					...collections.map((c: { _id: Id<'collections'> }) => c._id),
					UNCOLLECTED
				];
				if (prefs) {
					sortBy = (prefs.sortMode as SortOption) ?? 'dateAddedNewest';
					viewMode = (prefs.viewMode as ViewMode) ?? 'grid';
					if (prefs.filterCollectionIds && prefs.filterCollectionIds.length > 0) {
						const saved: string[] = [...(prefs.filterCollectionIds as string[])];
						if ((prefs as any).includeUncollected !== false) saved.push(UNCOLLECTED);
						filterCollectionIds = new SvelteSet(saved);
					} else {
						filterCollectionIds = new SvelteSet(allIds);
					}
				} else {
					filterCollectionIds = new SvelteSet(allIds);
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

	function handleFilterChange(selected: Set<string>) {
		filterCollectionIds = new SvelteSet(selected);
		if (prefsInitialized) {
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
	const allSelected = $derived(
		!collectionsQuery.data || filterCollectionIds.size === totalOptions
	);

	// Split sentinel from real collection IDs for the query
	const queryCollectionIds = $derived(
		[...filterCollectionIds].filter((id) => id !== UNCOLLECTED) as Id<'collections'>[]
	);
	const includeUncollected = $derived(filterCollectionIds.has(UNCOLLECTED));

	// Use query with sort option and optional collection filter
	const items = useQuery(api.items.list, () => ({
		sortBy,
		...(!allSelected
			? { collectionIds: queryCollectionIds, includeUncollected }
			: {})
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
