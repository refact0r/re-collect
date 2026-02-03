<script lang="ts">
	import { useConvexClient } from 'convex-svelte';
	import { api } from '../../convex/_generated/api.js';
	import IconClose from '~icons/material-symbols/close-sharp';

	interface Props {
		onClose: () => void;
	}

	let { onClose }: Props = $props();

	const client = useConvexClient();

	let name = $state('');
	let isCreating = $state(false);

	async function handleCreate() {
		if (!name.trim()) return;

		isCreating = true;
		try {
			await client.mutation(api.collections.create, {
				name: name.trim()
			});
			onClose();
		} finally {
			isCreating = false;
		}
	}

	function handleBackdropClick(event: MouseEvent) {
		if (event.target === event.currentTarget) {
			onClose();
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			onClose();
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
	<div class="modal">
		<button class="close-btn" onclick={onClose}>
			<IconClose />
		</button>
		<h2>new collection</h2>
		<div class="form">
			<input type="text" bind:value={name} placeholder="collection name" disabled={isCreating} />
			<div class="actions">
				<button onclick={handleCreate} disabled={isCreating || !name.trim()}>create</button>
				<button onclick={onClose} disabled={isCreating}>cancel</button>
			</div>
		</div>
	</div>
</div>

<style>
	h2 {
		margin: 0 0 1rem 0;
	}
</style>
