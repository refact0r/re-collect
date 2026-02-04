<script lang="ts">
	import { getContext } from 'svelte';
	import { useConvexClient } from 'convex-svelte';
	import { api } from '../../convex/_generated/api.js';
	import { mutate } from '$lib/mutationHelper.js';

	interface Props {
		onClose: () => void;
	}

	let { onClose }: Props = $props();

	const client = useConvexClient();
	const writeToken = getContext<string | null>('writeToken');

	let name = $state('');
	let isCreating = $state(false);

	async function handleCreate() {
		if (!name.trim()) return;

		isCreating = true;
		try {
			const result = await mutate(writeToken, (token) =>
				client.mutation(api.collections.create, {
					name: name.trim(),
					token
				})
			);
			if (result !== null) {
				onClose();
			}
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

<div class="backdrop" onclick={handleBackdropClick} role="dialog" aria-modal="true" tabindex="-1">
	<div class="modal">
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

	.actions {
		display: flex;
		gap: 0.5rem;
		width: 100%;
	}

	.actions button {
		flex: 1;
	}
</style>
