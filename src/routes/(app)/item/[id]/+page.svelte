<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import ItemEditor from '$lib/components/ItemEditor.svelte';
	import type { Id } from '../../../../convex/_generated/dataModel.js';

	const itemId = $derived(page.params.id as Id<'items'>);

	function handleClose() {
		goto('/');
	}
</script>

<div class="container">
	<ItemEditor {itemId} onClose={handleClose} onDelete={handleClose} />
</div>

<style>
	.container {
		height: 100%;
		display: flex;
		flex-direction: column;
	}
</style>
