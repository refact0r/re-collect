<script lang="ts">
	import { useQuery, useConvexClient } from 'convex-svelte';
	import { api } from '../../convex/_generated/api.js';
	import type { Id } from '../../convex/_generated/dataModel.js';

	interface Props {
		itemId: Id<'items'>;
		onSave: () => void;
		onDelete: () => void;
		onCancel: () => void;
	}

	let { itemId, onSave, onDelete, onCancel }: Props = $props();

	const client = useConvexClient();
	const item = useQuery(api.items.get, () => ({ id: itemId }));
	const collections = useQuery(api.collections.list, {});

	let title = $state('');
	let description = $state('');
	let url = $state('');
	let content = $state('');
	let initialized = $state(false);

	$effect(() => {
		if (item.data && !initialized) {
			title = item.data.title ?? '';
			description = item.data.description ?? '';
			url = item.data.url ?? '';
			content = item.data.content ?? '';
			initialized = true;
		}
	});

	async function handleSave() {
		await client.mutation(api.items.update, {
			id: itemId,
			title: title || undefined,
			description: description || undefined,
			url: url || undefined,
			content: content || undefined
		});
		onSave();
	}

	async function handleDelete() {
		if (confirm('Delete this item?')) {
			await client.mutation(api.items.remove, { id: itemId });
			onDelete();
		}
	}

	async function toggleCollection(collectionId: Id<'collections'>) {
		if (!item.data) return;
		if (item.data.collections.includes(collectionId)) {
			await client.mutation(api.items.removeFromCollection, { itemId, collectionId });
		} else {
			await client.mutation(api.items.addToCollection, { itemId, collectionId });
		}
	}
</script>

{#if item.isLoading}
	<p>Loading...</p>
{:else if item.error}
	<p>Error: {item.error.message}</p>
{:else if !item.data}
	<p>Item not found</p>
{:else}
	{#if item.data.type === 'image' && item.data.imageUrl}
		<img src={item.data.imageUrl} alt={item.data.title ?? 'Image'} class="preview" />
	{/if}

	<div class="form">
		<label>
			Title
			<input type="text" bind:value={title} />
		</label>

		<label>
			Description
			<textarea bind:value={description} rows="3"></textarea>
		</label>

		{#if item.data.type === 'url'}
			<label>
				URL
				<input type="url" bind:value={url} />
			</label>
		{/if}

		{#if item.data.type === 'text'}
			<label>
				Content
				<textarea bind:value={content} rows="5"></textarea>
			</label>
		{/if}

		<div class="collections-section">
			<h3>Collections</h3>
			{#if collections.isLoading}
				<p>Loading collections...</p>
			{:else if collections.data?.length === 0}
				<p>No collections yet. <a href="/collections">Create one</a></p>
			{:else}
				<div class="collection-list">
					{#each collections.data ?? [] as collection (collection._id)}
						<label class="collection-item">
							<input
								type="checkbox"
								checked={item.data.collections.includes(collection._id)}
								onchange={() => toggleCollection(collection._id)}
							/>
							{collection.name}
						</label>
					{/each}
				</div>
			{/if}
		</div>

		<div class="actions">
			<button onclick={handleSave}>Save</button>
			<button onclick={handleDelete} class="delete">Delete</button>
			<button onclick={onCancel} class="cancel">Cancel</button>
		</div>

		<div class="meta">
			<p>Added: {new Date(item.data.dateAdded).toLocaleString()}</p>
			<p>Modified: {new Date(item.data.dateModified).toLocaleString()}</p>
		</div>
	</div>
{/if}

<style>
	.preview {
		max-width: 100%;
		max-height: 300px;
		margin-bottom: 1rem;
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
	.collections-section {
		border: 1px solid #ddd;
		padding: 1rem;
	}
	.collections-section h3 {
		margin: 0 0 0.5rem 0;
	}
	.collection-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.collection-item {
		flex-direction: row;
		align-items: center;
		gap: 0.5rem;
	}
	.actions {
		display: flex;
		gap: 0.5rem;
	}
	button {
		padding: 0.5rem 1rem;
	}
	.delete {
		background: #fee;
		border-color: #fcc;
	}
	.cancel {
		background: #eee;
	}
	.meta {
		font-size: 0.875rem;
		color: #666;
	}
</style>
