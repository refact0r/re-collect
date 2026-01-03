<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { useQuery, useConvexClient } from 'convex-svelte';
	import { api } from '../../../../convex/_generated/api.js';
	import type { Id } from '../../../../convex/_generated/dataModel.js';

	const client = useConvexClient();
	const collectionId = $derived($page.params.id as Id<'collections'>);
	const collection = useQuery(api.collections.get, () => ({ id: collectionId }));

	let name = $state('');
	let description = $state('');
	let initialized = $state(false);

	$effect(() => {
		if (collection.data && !initialized) {
			name = collection.data.name;
			description = collection.data.description ?? '';
			initialized = true;
		}
	});

	async function handleSave() {
		if (!name.trim()) return;
		await client.mutation(api.collections.update, {
			id: collectionId,
			name: name.trim(),
			description: description.trim() || undefined
		});
		goto(`/collections/${collectionId}`);
	}

	async function handleDelete() {
		if (confirm('Delete this collection? Items will not be deleted.')) {
			await client.mutation(api.collections.remove, { id: collectionId });
			goto('/collections');
		}
	}
</script>

{#if collection.isLoading}
	<p>Loading...</p>
{:else if collection.error}
	<p>Error: {collection.error.message}</p>
{:else if !collection.data}
	<p>Collection not found</p>
{:else}
	<div class="container">
		<h1>Edit Collection</h1>

		<div class="form">
			<label>
				Name
				<input type="text" bind:value={name} />
			</label>

			<label>
				Description
				<textarea bind:value={description} rows="3"></textarea>
			</label>

			<div class="actions">
				<button onclick={handleSave} disabled={!name.trim()}>Save</button>
				<button onclick={handleDelete} class="delete">Delete</button>
				<a href="/collections/{collectionId}">Cancel</a>
			</div>
		</div>
	</div>
{/if}

<style>
	.container {
		max-width: 600px;
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
	input,
	textarea {
		padding: 0.5rem;
		font-size: 1rem;
	}
	.actions {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}
	button {
		padding: 0.5rem 1rem;
	}
	.delete {
		background: #fee;
		border-color: #fcc;
	}
</style>
