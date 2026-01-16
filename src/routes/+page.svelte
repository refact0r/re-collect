<script lang="ts">
	import { getContext } from 'svelte';
	import ItemGrid from '$lib/components/ItemGrid.svelte';
	import ItemInput from '$lib/components/ItemInput.svelte';

	const items = getContext<ReturnType<typeof import('convex-svelte').useQuery>>('items');
	const currentItemsContext = getContext<{
		items: any[];
		setItems: (items: any[]) => void;
	}>('currentItems');

	// Update the current items when data changes
	$effect(() => {
		if (items.data) {
			currentItemsContext.setItems(items.data);
		}
	});
</script>

<div class="container">
	<div class="input-wrapper">
		<ItemInput />
	</div>

	{#if items.isLoading}
		<p>loading...</p>
	{:else if items.error}
		<p>error: {items.error.message}</p>
	{:else if items.data?.length === 0}
		<p>no items yet. add your first one above!</p>
	{:else}
		<ItemGrid items={items.data ?? []} />
	{/if}
</div>

<style>
	.input-wrapper {
		margin-bottom: 1rem;
	}
</style>
