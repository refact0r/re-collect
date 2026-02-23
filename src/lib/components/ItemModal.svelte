<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { getContext } from 'svelte';
	import ItemEditor from './ItemEditor.svelte';
	import type { Id } from '../../convex/_generated/dataModel.js';

	interface Props {
		itemId: Id<'items'>;
		onClose: () => void;
	}

	let { itemId, onClose }: Props = $props();

	let editor = $state<ItemEditor>();

	// Get current items from context (set by the active page)
	const currentItemsContext = getContext<{
		items: any[];
		setItems: (items: any[]) => void;
	}>('currentItems');

	const currentItems = $derived(currentItemsContext.items);

	function handleClose() {
		editor?.save();
		onClose();
	}

	async function navigateToItem(newItemId: Id<'items'>) {
		editor?.save();

		const params = new URLSearchParams(page.url.searchParams);
		params.set('item', newItemId);
		await goto(`${page.url.pathname}?${params}`, { replaceState: false, noScroll: true });
	}

	function handleBackdropClick(event: MouseEvent) {
		if (event.target === event.currentTarget) {
			handleClose();
		}
	}

	async function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			handleClose();
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

			const currentIndex = currentItems.findIndex((item: any) => item._id === itemId);
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
<div
	class="backdrop"
	onclick={handleBackdropClick}
	role="dialog"
	aria-modal="true"
	tabindex="-1"
>
	<div class="modal modal-wide">
		{#key itemId}
			<ItemEditor bind:this={editor} {itemId} onClose={onClose} onDelete={onClose} />
		{/key}
	</div>
</div>

<style>
	.modal {
		height: calc(100vh - 4rem);
	}

	@media (max-width: 768px) {
		.backdrop {
			align-items: flex-start;
		}

		.modal {
			height: 100vh;
			max-height: 100vh;
			width: 100vw;
			max-width: 100vw;
			border: none;
			padding: 0;
		}
	}
</style>
