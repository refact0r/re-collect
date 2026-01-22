<script lang="ts">
	import { getContext } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import ItemEditor from './ItemEditor.svelte';
	import type { Id } from '../../convex/_generated/dataModel.js';

	interface Props {
		itemId: Id<'items'>;
		onClose: () => void;
	}

	let { itemId, onClose }: Props = $props();

	let saveFunction: (() => Promise<void>) | undefined = $state();

	// Get current items from context (set by the active page)
	const currentItemsContext = getContext<{
		items: any[];
		setItems: (items: any[]) => void;
	}>('currentItems');

	const currentItems = $derived(currentItemsContext.items);

	function handleSaveReady(saveFn: () => Promise<void>) {
		saveFunction = saveFn;
	}

	async function handleClose() {
		if (saveFunction) {
			await saveFunction();
		} else {
			onClose();
		}
	}

	async function navigateToItem(newItemId: Id<'items'>) {
		// Save current item before navigating
		if (saveFunction) {
			await saveFunction();
		}

		// Update URL to show new item
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
		// Don't intercept arrow keys when typing in input fields
		const target = event.target as HTMLElement;
		if (
			event.key === 'ArrowLeft' || event.key === 'ArrowRight'
		) {
			if (
				target instanceof HTMLInputElement ||
				target instanceof HTMLTextAreaElement ||
				target.isContentEditable
			) {
				return;
			}
		}

		if (event.key === 'Escape') {
			handleClose();
			return;
		}

		// Arrow key navigation
		if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
			const currentIndex = currentItems.findIndex((item: any) => item._id === itemId);
			if (currentIndex === -1) return;

			let newIndex: number;
			if (event.key === 'ArrowLeft') {
				newIndex = currentIndex - 1;
				if (newIndex < 0) newIndex = currentItems.length - 1; // Wrap to end
			} else {
				newIndex = currentIndex + 1;
				if (newIndex >= currentItems.length) newIndex = 0; // Wrap to start
			}

			const newItem = currentItems[newIndex];
			if (newItem) {
				event.preventDefault();
				await navigateToItem(newItem._id);
			}
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div
	class="backdrop"
	onclick={handleBackdropClick}
	role="dialog"
	aria-modal="true"
	tabindex="-1"
>
	<div class="modal modal-wide">
		<button class="close-btn" onclick={handleClose}>×</button>
		{#key itemId}
			<ItemEditor {itemId} onSave={onClose} onDelete={onClose} onReady={handleSaveReady} />
		{/key}
	</div>
</div>

<style>
	.modal {
		height: calc(100vh - 4rem);
	}
</style>
