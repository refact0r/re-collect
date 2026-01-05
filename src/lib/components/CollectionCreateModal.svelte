<script lang="ts">
	import { useConvexClient } from 'convex-svelte';
	import { api } from '../../convex/_generated/api.js';

	interface Props {
		onClose: () => void;
	}

	let { onClose }: Props = $props();

	const client = useConvexClient();

	let name = $state('');
	let description = $state('');
	let isCreating = $state(false);

	async function handleCreate() {
		if (!name.trim()) return;

		isCreating = true;
		try {
			await client.mutation(api.collections.create, {
				name: name.trim(),
				description: description.trim() || undefined
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
	onkeydown={handleKeydown}
	role="dialog"
	aria-modal="true"
	tabindex="-1"
>
	<div class="modal">
		<button class="close-btn" onclick={onClose}>×</button>
		<h2>Create New Collection</h2>
		<div class="form">
			<label>
				Name
				<input type="text" bind:value={name} placeholder="Collection name" disabled={isCreating} />
			</label>
			<label>
				Description (optional)
				<textarea
					bind:value={description}
					rows="3"
					placeholder="Description"
					disabled={isCreating}
				></textarea>
			</label>
			<div class="actions">
				<button onclick={handleCreate} disabled={isCreating || !name.trim()}>Create</button>
				<button onclick={onClose} disabled={isCreating}>Cancel</button>
			</div>
		</div>
	</div>
</div>

<style>
	.backdrop {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: oklch(from var(--bg-1) l c h / 0.9);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
	}
	.modal {
		background: var(--bg-1);
		border: 1px solid var(--border);
		padding: 1.5rem;
		max-width: 500px;
		width: 90%;
		position: relative;
	}
	.close-btn {
		position: absolute;
		top: 0.5rem;
		right: 0.5rem;
		background: none;
		border: none;
		font-size: 1.5rem;
		padding: 0.25rem 0.5rem;
	}
	h2 {
		margin: 0 0 1rem 0;
	}
	.form {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.actions {
		display: flex;
		gap: 0.5rem;
	}
</style>
