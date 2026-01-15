<script lang="ts">
	import ItemEditor from './ItemEditor.svelte';
	import type { Id } from '../../convex/_generated/dataModel.js';

	interface Props {
		itemId: Id<'items'>;
		onClose: () => void;
	}

	let { itemId, onClose }: Props = $props();

	let saveFunction: (() => Promise<void>) | undefined = $state();

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

	function handleBackdropClick(event: MouseEvent) {
		if (event.target === event.currentTarget) {
			handleClose();
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			handleClose();
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div
	class="backdrop"
	onclick={handleBackdropClick}
	onkeydown={handleKeydown}
	role="dialog"
	aria-modal="true"
	tabindex="-1"
>
	<div class="modal modal-wide">
		<button class="close-btn" onclick={handleClose}>×</button>
		<ItemEditor {itemId} onSave={onClose} onDelete={onClose} onReady={handleSaveReady} />
	</div>
</div>

<style>
	.modal {
		height: calc(100vh - 4rem);
	}
</style>
