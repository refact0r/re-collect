<script lang="ts">
	import type { Id } from '../../convex/_generated/dataModel.js';
	import { getCurrentItemsContext, type QueryState } from '#lib/context.js';
	import type { ViewPrefs } from '#lib/prefs.svelte.js';
	import type { DisplayItem } from '#lib/types.js';
	import ItemGrid from './ItemGrid.svelte';
	import ItemList from './ItemList.svelte';

	interface Props {
		items: QueryState<DisplayItem[]>;
		prefs: ViewPrefs;
		empty: string;
		loading?: string;
		onReorder?: (itemId: Id<'items'>, newPosition: string) => void;
		// Someone else's items (a shared collection): shown without owner controls
		readonly?: boolean;
	}

	let { items, prefs, empty, loading = 'loading...', onReorder, readonly }: Props = $props();

	// The item modal steps through the list shown here (set during init so the
	// modal, rendered after the page, sees it at once), until a page without one
	const currentItems = getCurrentItemsContext();
	const list = () => items.data ?? [];
	currentItems.list = list;
	$effect(() => () => {
		if (currentItems.list === list) currentItems.list = () => [];
	});
</script>

<!-- No data and no error is loading, or a query skipped until its args are known -->
{#if items.error}
	<p class="status-text">error: {items.error.message}</p>
{:else if !items.data}
	<p class="status-text">{loading}</p>
{:else if items.data.length === 0}
	<p class="status-text">{empty}</p>
{:else if prefs.viewMode === 'list'}
	<ItemList items={items.data} {readonly} />
{:else}
	<ItemGrid
		items={items.data}
		columnOffset={prefs.columnOffset}
		showTitles={prefs.showTitles}
		{onReorder}
		{readonly}
	/>
{/if}
