<script lang="ts">
	import { getContext } from 'svelte';
	import { useConvexClient } from 'convex-svelte';
	import { api } from '../../convex/_generated/api.js';
	import type { Id } from '../../convex/_generated/dataModel.js';
	import { getImage } from '$lib/imageCache.svelte.js';
	import { mutate } from '$lib/mutationHelper.js';
	import IconOpenInNew from '~icons/material-symbols-light/open-in-new-sharp';
	import IconCheck from '~icons/material-symbols/check';
	import IconDelete from '~icons/material-symbols-light/delete-outline-sharp';

	interface Props {
		itemId: Id<'items'>;
		onClose: () => void;
		onDelete: () => void;
	}

	let { itemId, onClose, onDelete }: Props = $props();

	const client = useConvexClient();
	const allItems = getContext<ReturnType<typeof import('convex-svelte').useQuery>>('items');
	const collections =
		getContext<ReturnType<typeof import('convex-svelte').useQuery>>('collections');
	const getWriteToken = getContext<() => string | null>('writeToken');
	const writeToken = $derived(getWriteToken());

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

	export async function save() {
		await mutate(writeToken, (token) =>
			client.mutation(api.items.update, {
				id: itemId,
				title,
				description,
				url,
				content,
				token
			})
		);
	}

	function handleDone() {
		save();
		onClose();
	}

	async function handleDelete() {
		if (confirm('Delete this item?')) {
			// Close modal immediately to avoid showing "item not found" error
			// as Convex updates the items list in real-time
			onDelete();

			// Delete in background
			await mutate(writeToken, (token) =>
				client.mutation(api.items.remove, { id: itemId, token })
			);
		}
	}

	async function toggleCollection(collectionId: Id<'collections'>) {
		if (!item.data) return;
		if (item.data.collections.includes(collectionId)) {
			await mutate(writeToken, (token) =>
				client.mutation(api.items.removeFromCollection, { itemId, collectionId, token })
			);
		} else {
			await mutate(writeToken, (token) =>
				client.mutation(api.items.addToCollection, { itemId, collectionId, token })
			);
		}
	}
</script>

{#if item.isLoading}
	<p class="status-text">loading...</p>
{:else if item.error}
	<p class="status-text">error: {item.error.message}</p>
{:else if !item.data}
	<p class="status-text">item not found</p>
{:else}
	<div class="editor-layout">
		<!-- Content Preview -->
		<div class="content-preview">
			{#if item.data.type === 'image' && item.data.imageUrl}
				<img src={getImage(itemId, item.data.imageUrl)} alt={item.data.title ?? 'image'} />
			{:else if item.data.type === 'url'}
				{#if item.data.screenshotStatus === 'completed' && item.data.imageUrl}
					<img
						src={getImage(itemId, item.data.imageUrl)}
						alt={item.data.title ?? item.data.url ?? 'screenshot'}
					/>
				{:else}
					<div class="url-preview">
						<p class="url-text">{url || item.data.url}</p>
					</div>
				{/if}
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

			<label>
				{item.data.type === 'url' ? 'url' : 'source url'}
				<div class="url-input-row">
					<input type="url" bind:value={url} />
					<a
						href={url}
						target="_blank"
						rel="noopener noreferrer"
						class="icon-filled"
						aria-label="open url"
					>
						<IconOpenInNew />
					</a>
				</div>
			</label>

			<div class="collections-field">
				<div class="field-label">collections</div>
				<div class="collections-container">
					{#if collections.isLoading}
						<p class="status-text">loading collections...</p>
					{:else if collections.data?.length === 0}
						<p class="status-text">no collections yet. <a href="/collections">create one</a></p>
					{:else}
						<div class="collection-list">
							{#each collections.data ?? [] as collection (collection._id)}
								<label class="checkbox-label">
									<input
										type="checkbox"
										checked={item.data.collections.includes(collection._id)}
										onchange={() => toggleCollection(collection._id)}
									/>
									<span class="checkbox">
										{#if item.data.collections.includes(collection._id)}
											<IconCheck />
										{/if}
									</span>
									{collection.name}
								</label>
							{/each}
						</div>
					{/if}
				</div>
			</div>

			<div class="meta">
				<p>added: {new Date(item.data.dateAdded).toLocaleString()}</p>
				<p>modified: {new Date(item.data.dateModified).toLocaleString()}</p>
			</div>

			<div class="actions">
				<button onclick={handleDone}>done</button>
				<button onclick={handleDelete} class="icon-filled danger" aria-label="delete item">
					<IconDelete />
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
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
		resize: vertical;
		font-family: var(--font);
		font-size: 1rem;
	}

	.collections-field {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.field-label {
		font-size: 1rem;
	}

	.collections-container {
		border: 1px solid var(--border);
		padding: 1rem;
		max-height: 12rem;
		overflow-y: auto;
	}

	.collection-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.checkbox-label {
		flex-direction: row;
		align-items: center;
		gap: 1rem;
		cursor: pointer;
	}

	.checkbox-label input {
		position: absolute;
		opacity: 0;
		pointer-events: none;
	}

	.checkbox {
		width: 1.125rem;
		height: 1.125rem;
		border: 1px solid var(--border);
		background: var(--bg-2);
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}

	.checkbox-label:hover .checkbox {
		border-color: var(--txt-3);
	}

	.checkbox-label input:checked + .checkbox {
		background: var(--txt-2);
		border-color: var(--txt-2);
		color: var(--bg-1);
	}

	.checkbox :global(svg) {
		width: 0.875rem;
		height: 0.875rem;
	}

	.url-input-row {
		display: flex;
		gap: 0.5rem;
	}

	.url-input-row input {
		flex: 1;
	}

	.actions {
		margin-top: auto;
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}

	.actions button:first-child {
		flex: 1;
	}

	@media (max-width: 768px) {
		.editor-layout {
			display: block;
			height: auto;
		}

		.content-preview {
			position: static;
			display: block;
			padding: 1rem;
			container-type: normal;
		}

		.content-preview img {
			width: 100%;
			height: auto;
			display: block;
		}

		.form {
			width: 100%;
			padding: 1rem;
			padding-bottom: 5rem;
		}

		.text-content {
			min-height: 30vh;
		}

		.actions {
			display: flex;
			gap: 0.5rem;
		}
	}
</style>
