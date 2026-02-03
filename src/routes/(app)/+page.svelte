<script lang="ts">
	import { getContext } from 'svelte';
	import { browser } from '$app/environment';
	import { useConvexClient, useQuery } from 'convex-svelte';
	import { api } from '../../convex/_generated/api.js';
	import type { Id } from '../../convex/_generated/dataModel.js';
	import ItemGrid from '$lib/components/ItemGrid.svelte';
	import ItemList from '$lib/components/ItemList.svelte';
	import TopControls from '$lib/components/TopControls.svelte';
	import { type ViewMode } from '$lib/components/ViewToggle.svelte';

	const STORAGE_KEY = 'recollect:homepage-prefs';

	const client = useConvexClient();
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

	// Load saved preferences from localStorage
	function loadPrefs(): { sortBy: SortOption; viewMode: ViewMode } {
		if (!browser) return { sortBy: 'dateAddedNewest', viewMode: 'grid' };
		try {
			const saved = localStorage.getItem(STORAGE_KEY);
			if (saved) {
				const parsed = JSON.parse(saved);
				return {
					sortBy: parsed.sortBy ?? 'dateAddedNewest',
					viewMode: parsed.viewMode ?? 'grid'
				};
			}
		} catch {
			// Ignore parse errors
		}
		return { sortBy: 'dateAddedNewest', viewMode: 'grid' };
	}

	function savePrefs(sortBy: SortOption, viewMode: ViewMode) {
		if (!browser) return;
		localStorage.setItem(STORAGE_KEY, JSON.stringify({ sortBy, viewMode }));
	}

	const initialPrefs = loadPrefs();
	let sortBy = $state<SortOption>(initialPrefs.sortBy);
	let viewMode = $state<ViewMode>(initialPrefs.viewMode);

	function handleSortChange(newSort: SortOption) {
		sortBy = newSort;
		savePrefs(sortBy, viewMode);
	}

	function handleViewModeChange(newMode: ViewMode) {
		viewMode = newMode;
		savePrefs(sortBy, viewMode);
	}

	// Use query with sort option
	const items = useQuery(api.items.list, () => ({ sortBy }));

	// Update the current items when data changes
	$effect(() => {
		if (items.data) {
			currentItemsContext.setItems(items.data);
		}
	});

	async function handleRetryScreenshot(itemId: Id<'items'>) {
		await client.mutation(api.screenshots.retryScreenshot, { itemId });
	}
</script>

<div class="container">
	<TopControls
		{sortBy}
		{viewMode}
		onSortChange={handleSortChange}
		onViewModeChange={handleViewModeChange}
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

