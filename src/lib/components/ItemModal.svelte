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

	// Left/right step through the page's items, except while typing. The editor saves
	// its own edits when it unmounts, so stepping only swaps the URL.
	function handleKeydown(event: KeyboardEvent) {
		if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
		const target = event.target as HTMLElement;
		if (
			target instanceof HTMLInputElement ||
			target instanceof HTMLTextAreaElement ||
			target.isContentEditable
		) {
			return;
		}

		const index = currentItems.findIndex((i) => i._id === itemId);
		if (index === -1) return;
		const step = event.key === 'ArrowLeft' ? -1 : 1;
		const next = currentItems[(index + step + currentItems.length) % currentItems.length];
		event.preventDefault();
		goto(getItemUrl(next._id), { replace: true, reset: false });
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
