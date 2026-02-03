<script lang="ts">
	import { getContext } from 'svelte';
	import { useConvexClient } from 'convex-svelte';
	import { api } from '../../../convex/_generated/api.js';
	import type { Id } from '../../../convex/_generated/dataModel.js';
	import CollectionCreateModal from '$lib/components/CollectionCreateModal.svelte';
	import { getImage } from '$lib/imageCache.svelte';
	import IconDelete from '~icons/material-symbols-light/delete-outline-sharp';

	const client = useConvexClient();
	const collections =
		getContext<ReturnType<typeof import('convex-svelte').useQuery>>('collections');

	let showCreateModal = $state(false);

	async function handleDelete(id: Id<'collections'>) {
		if (confirm('Delete this collection? Items will not be deleted.')) {
			await client.mutation(api.collections.remove, { id });
		}
	}
</script>

<div class="container">
	<div class="page-header">
		<h1>collections</h1>
		<button onclick={() => (showCreateModal = true)}>new collection</button>
	</div>

	{#if collections.isLoading}
		<p class="status-text">loading...</p>
	{:else if collections.error}
		<p class="status-text">error: {collections.error.message}</p>
	{:else if collections.data?.length === 0}
		<p class="status-text">no collections yet. click "new collection" to create your first one!</p>
	{:else}
		<div class="list">
			{#each collections.data ?? [] as collection (collection._id)}
				<a href="/collections/{collection._id}" class="clickable collection-card">
					<div class="info-row">
						<div class="collection-info">
							<h3>{collection.name}</h3>
							<p class="count">
								{collection.itemCount}
								{collection.itemCount === 1 ? 'item' : 'items'}
							</p>
						</div>
						<button
							class="icon danger"
							onclick={(e) => {
								e.preventDefault();
								e.stopPropagation();
								handleDelete(collection._id);
							}}
						>
							<IconDelete />
						</button>
					</div>
					{#if collection.previews?.length > 0}
						<div class="preview-row">
							{#each collection.previews as preview (preview._id)}
								<div class="thumb-wrapper">
									<img
										src={getImage(preview._id, preview.imageUrl)}
										alt=""
										class="preview-thumb"
										loading="lazy"
									/>
								</div>
							{/each}
							{#each Array(Math.max(0, 4 - (collection.previews?.length || 0))) as _, i (i)}
								<div class="thumb-wrapper placeholder"></div>
							{/each}
						</div>
					{/if}
				</a>
			{/each}
		</div>
	{/if}
</div>

{#if showCreateModal}
	<CollectionCreateModal onClose={() => (showCreateModal = false)} />
{/if}

<style>
	.list {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(20rem, 1fr));
		gap: var(--spacing);
	}
	.collection-card {
		padding: var(--spacing);
		display: flex;
		flex-direction: column;
		gap: var(--spacing);
	}
	.collection-card:has(button:hover) {
		background-color: transparent;
	}
	.info-row {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: var(--spacing);
	}
	.collection-info h3 {
		margin: 0;
	}
	.count {
		font-size: 0.875rem;
		color: var(--txt-3);
		margin: 0.25rem 0 0 0;
	}
	.preview-row {
		display: flex;
		gap: 0.5rem;
		overflow: hidden;
	}
	.thumb-wrapper {
		display: flex;
		aspect-ratio: 1 / 1;
		flex: 1;
	}
	.thumb-wrapper.placeholder {
		border: 1px solid var(--border);
	}
	.preview-thumb {
		max-width: 100%;
		width: 100%;
		object-fit: cover;
		background: var(--bg-2);
		flex-shrink: 0;
	}
</style>
