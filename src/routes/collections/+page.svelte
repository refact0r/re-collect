<script lang="ts">
	import { getContext } from 'svelte';
	import { useConvexClient } from 'convex-svelte';
	import { api } from '../../convex/_generated/api.js';
	import type { Id } from '../../convex/_generated/dataModel.js';
	import CollectionCreateModal from '$lib/components/CollectionCreateModal.svelte';

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
		<p>loading...</p>
	{:else if collections.error}
		<p>error: {collections.error.message}</p>
	{:else if collections.data?.length === 0}
		<p>no collections yet. click "new collection" to create your first one!</p>
	{:else}
		<div class="list">
			{#each collections.data ?? [] as collection (collection._id)}
				<div class="collection-card">
					<a href="/collections/{collection._id}" class="collection-link">
						<h3>{collection.name}</h3>
						{#if collection.description}
							<p class="description">{collection.description}</p>
						{/if}
						<p class="count">{collection.itemCount} item(s)</p>
					</a>
					<button class="link" onclick={() => handleDelete(collection._id)}>delete</button>
				</div>
			{/each}
		</div>
	{/if}
</div>

{#if showCreateModal}
	<CollectionCreateModal onClose={() => (showCreateModal = false)} />
{/if}

<style>
	/* Uses global .page-header, .card, button.link styles from app.css */
	.list {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.collection-card {
		border: 1px solid var(--border);
		padding: 1rem;
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
	}
	.collection-link {
		text-decoration: none;
		flex: 1;
	}
	.collection-link h3 {
		margin: 0;
	}
	.description {
		color: var(--txt-3);
		margin: 0.25rem 0;
	}
	.count {
		font-size: 0.875rem;
		color: var(--txt-3);
		margin: 0;
	}
</style>
