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
	}

	let { items, prefs, empty, loading = 'loading...', onReorder }: Props = $props();

	// The item modal steps through the list shown here
	getCurrentItemsContext().list = () => items.data ?? [];
</script>

<!-- No data and no error is loading, or a query skipped until its args are known -->
{#if items.error}
	<p class="status-text">error: {items.error.message}</p>
{:else if !items.data}
	<p class="status-text">{loading}</p>
{:else if items.data.length === 0}
	<p class="status-text">{empty}</p>
{:else if prefs.viewMode === 'list'}
	<ItemList items={items.data} />
{:else}
	<ItemGrid
		items={items.data}
		columnOffset={prefs.columnOffset}
		showTitles={prefs.showTitles}
		{onReorder}
	/>
{/if}
