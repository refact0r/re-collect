<script lang="ts">
	import { getContext } from 'svelte';
	import { useConvexClient, useQuery } from 'convex-svelte';
	import { api } from '../../convex/_generated/api.js';
	import type { Id } from '../../convex/_generated/dataModel.js';
	import ItemGrid from '$lib/components/ItemGrid.svelte';
	import ItemList from '$lib/components/ItemList.svelte';
	import TopControls from '$lib/components/TopControls.svelte';
	import { type ViewMode } from '$lib/components/ViewToggle.svelte';
	import { mutate } from '$lib/mutationHelper.js';

	const client = useConvexClient();
	const writeToken = getContext<string | null>('writeToken');
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

	function handleSortChange(newSort: SortOption) {
		sortBy = newSort;
	}

	function handleViewModeChange(newMode: ViewMode) {
		viewMode = newMode;
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

