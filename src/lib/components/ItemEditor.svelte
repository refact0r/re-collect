<script lang="ts">
	import { getContext } from 'svelte';
	import { useConvexClient } from 'convex-svelte';
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
	const allItems = getContext<ReturnType<typeof import('convex-svelte').useQuery>>('items');
	const collections =
		getContext<ReturnType<typeof import('convex-svelte').useQuery>>('collections');

	// Find the specific item from context
	const item = $derived.by(() => {
		if (allItems.isLoading || allItems.error || !allItems.data) {
			return { isLoading: allItems.isLoading, error: allItems.error, data: null };
		}
		return {
			isLoading: false,
			error: null,
			data: allItems.data.find((i: any) => i._id === itemId) ?? null
		};
	});

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
			title,
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
	<p>loading...</p>
{:else if item.error}
	<p>error: {item.error.message}</p>
{:else if !item.data}
	<p>item not found</p>
{:else}
	<div class="editor-layout">
		<!-- Content Preview -->
		<div class="content-preview">
			{#if item.data.type === 'image' && item.data.imageUrl}
				<img src={item.data.imageUrl} alt={item.data.title ?? 'image'} />
			{:else if item.data.type === 'url'}
				<div class="url-preview">
					<p class="url-text">{url || item.data.url}</p>
				</div>
			{:else if item.data.type === 'text'}
				<textarea class="text-content" bind:value={content}></textarea>
			{/if}
		</div>

		<!-- Properties & Controls -->
		<div class="form">
			<label>
				title
				<input type="text" bind:value={title} />
			</label>

			<label>
				description
				<textarea bind:value={description} rows="3"></textarea>
			</label>

			{#if item.data.type === 'url'}
				<label>
					url
					<input type="url" bind:value={url} />
				</label>
			{/if}

			<div class="section">
				<h3>collections</h3>
				{#if collections.isLoading}
					<p class="status-text">loading collections...</p>
				{:else if collections.data?.length === 0}
					<p class="status-text">no collections yet. <a href="/collections">create one</a></p>
				{:else}
					<div class="collection-list">
						{#each collections.data ?? [] as collection (collection._id)}
							<label class="horizontal">
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
				<button onclick={handleSave}>save</button>
				<button onclick={handleDelete} class="danger">delete</button>
				<button onclick={onCancel}>cancel</button>
			</div>

			<div class="meta">
				<p>added: {new Date(item.data.dateAdded).toLocaleString()}</p>
				<p>modified: {new Date(item.data.dateModified).toLocaleString()}</p>
			</div>
		</div>
	</div>
{/if}

<style>
	/* Uses global .form, .section, .meta, .status-text styles from app.css */

	.editor-layout {
		display: flex;
		gap: 1rem;
		align-items: stretch;
		min-height: 0;
		height: 100%;
	}

	.content-preview {
		position: sticky;
		top: 0;
		display: grid;
		place-items: center;
		flex: 1;
		min-height: 0;
		container-type: size;
	}

	.form {
		width: 25rem;
	}

	.content-preview img {
		width: 100cqw;
		height: 100cqh;
		object-fit: contain;
	}

	.url-preview {
		width: 100%;
		padding: 0.5rem;
		border: 1px solid var(--border);
		background: var(--bg-2);
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.url-preview .url-text {
		color: var(--txt-3);
		word-break: break-all;
		text-align: center;
	}

	.text-content {
		width: 100%;
		height: 100%;
		flex: 1;
		/* min-height: 25rem; */
		resize: vertical;
		font-family: var(--font);
		font-size: 1rem;
	}

	.collection-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
</style>
