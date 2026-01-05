<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import ItemEditor from '$lib/components/ItemEditor.svelte';
	import type { Id } from '../../../convex/_generated/dataModel.js';

	const itemId = $derived(page.params.id as Id<'items'>);

	function handleClose() {
		goto('/');
	}
</script>

<div class="container">
	<h1>Edit Item</h1>
	<ItemEditor {itemId} onSave={handleClose} onDelete={handleClose} onCancel={handleClose} />
</div>

<style>
	.container {
		max-width: 600px;
	}
	h1 {
		margin-bottom: 1rem;
	}
</style>
