<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import ItemEditor from './ItemEditor.svelte';
	import type { Id } from '../../convex/_generated/dataModel.js';
	import { getCurrentItemsContext, getItemsContext } from '#lib/context.js';

	interface Props {
		itemId: Id<'items'>;
		onClose: () => void;
	}

	let { itemId, onClose }: Props = $props();

	const allItems = getItemsContext();
	const item = $derived(allItems.data?.find((i) => i._id === itemId));

	const currentItemsContext = getCurrentItemsContext();
	const currentItems = $derived(currentItemsContext.list());

	// The editor saves its own edits when it unmounts, so navigating only swaps the URL
	async function navigateToItem(newItemId: Id<'items'>) {
		const params = new URLSearchParams(page.url.search);
		params.set('item', newItemId);
		await goto(`${page.url.pathname}?${params}`, { replace: true, reset: false });
	}

	function handleBackdropClick(event: MouseEvent) {
		if (event.target === event.currentTarget) {
			onClose();
		}
	}

	async function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			onClose();
			return;
		}

		// Arrow key navigation (skip when typing in input fields)
		if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
			const target = event.target as HTMLElement;
			if (
				target instanceof HTMLInputElement ||
				target instanceof HTMLTextAreaElement ||
				target.isContentEditable
			) {
				return;
			}

			const currentIndex = currentItems.findIndex((item) => item._id === itemId);
			if (currentIndex === -1) return;

			const direction = event.key === 'ArrowLeft' ? -1 : 1;
			const newIndex = (currentIndex + direction + currentItems.length) % currentItems.length;
			const newItem = currentItems[newIndex];
			if (newItem) {
				event.preventDefault();
				await navigateToItem(newItem._id);
			}
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="backdrop" onclick={handleBackdropClick} role="dialog" aria-modal="true" tabindex="-1">
	<div class="modal modal-wide">
		{#if allItems.isLoading}
			<p class="status-text">loading...</p>
		{:else if allItems.error}
			<p class="status-text">error: {allItems.error.message}</p>
		{:else if !item}
			<p class="status-text">item not found</p>
		{:else}
			{#key itemId}
				<ItemEditor {item} {onClose} />
			{/key}
		{/if}
	</div>
</div>

<style>
	.modal {
		height: calc(100vh - 4rem);
		overflow: hidden;
	}

	@media (max-width: 768px) {
		.backdrop {
			align-items: flex-start;
		}

		.modal {
			height: 100vh;
			max-height: 100vh;
			overflow-y: auto;
			width: 100vw;
			max-width: 100vw;
			border: none;
			padding: 0;
		}
	}
</style>
