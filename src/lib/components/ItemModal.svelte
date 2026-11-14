<script lang="ts">
	import { goto } from '$app/navigation';
	import ItemEditor from './ItemEditor.svelte';
	import Modal from './Modal.svelte';
	import type { Id } from '../../convex/_generated/dataModel.js';
	import { getCurrentItemsContext, getItemsContext } from '#lib/context.js';
	import { getItemUrl } from '#lib/itemDisplay.js';

	interface Props {
		itemId: Id<'items'>;
		onClose: () => void;
	}

	let { itemId, onClose }: Props = $props();

	const currentItemsContext = getCurrentItemsContext();
	const currentItems = $derived(currentItemsContext.list());

	// The signed-in user's own items open editable; anything else on the page (a
	// shared collection someone else owns) opens read-only
	const ownItems = getItemsContext();
	const ownItem = $derived(ownItems.data?.find((i) => i._id === itemId));
	const item = $derived(ownItem ?? currentItems.find((i) => i._id === itemId));

	// The editor saves its own edits when it unmounts, so navigating only swaps the URL
	async function navigateToItem(newItemId: Id<'items'>) {
		await goto(getItemUrl(newItemId), { replace: true, reset: false });
	}

	// Arrow key navigation (skip when typing in input fields)
	async function handleKeydown(event: KeyboardEvent) {
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

<Modal {onClose} onkeydown={handleKeydown} size="wide">
	{#if ownItems.isLoading}
		<p class="status-text">loading...</p>
	{:else if ownItems.error}
		<p class="status-text">error: {ownItems.error.message}</p>
	{:else if !item}
		<p class="status-text">item not found</p>
	{:else}
		{#key itemId}
			<ItemEditor {item} readonly={!ownItem} {onClose} />
		{/key}
	{/if}
</Modal>
