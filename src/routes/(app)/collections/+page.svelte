<script lang="ts">
	import { getContext, onDestroy } from 'svelte';
	import { useConvexClient } from 'convex-svelte';
	import { generateKeyBetween } from 'fractional-indexing';
	import { api } from '../../../convex/_generated/api.js';
	import type { Id } from '../../../convex/_generated/dataModel.js';
	import CollectionCreateModal from '$lib/components/CollectionCreateModal.svelte';
	import { mutate } from '$lib/mutationHelper.js';
	import IconDelete from '~icons/material-symbols-light/delete-outline-sharp';

	type CollectionCard = {
		_id: Id<'collections'>;
		name: string;
		itemCount: number;
		position?: string;
		previews: { _id: Id<'items'>; imageUrl: string; type: 'image' | 'url' }[];
	};

	const client = useConvexClient();
	const getWriteToken = getContext<() => string | null>('writeToken');
	const writeToken = $derived(getWriteToken());
	const collections =
		getContext<ReturnType<typeof import('convex-svelte').useQuery>>('collections');

	let showCreateModal = $state(false);

	async function handleDelete(id: Id<'collections'>) {
		if (confirm('Delete this collection? Items will not be deleted.')) {
			await mutate(writeToken, (token) => client.mutation(api.collections.remove, { id, token }));
		}
	}

	// ============ DRAG REORDERING ============
	const serverCollections = $derived((collections.data ?? []) as CollectionCard[]);

	let listElement: HTMLElement | undefined = $state();
	let draggedCollection: CollectionCard | null = $state(null);
	let targetIndex = $state(-1);
	let dragPosition = $state({ x: 0, y: 0 });
	let dragOffset = $state({ x: 0, y: 0 });
	let dragWidth = $state(0);

	// Grid slot rects and collection order captured at drag start (slots stay
	// fixed while cards swap between them, so these remain valid during the drag)
	let slotRects: DOMRect[] = [];
	let dragSnapshot: CollectionCard[] = [];

	const displayCollections = $derived.by(() => {
		if (!draggedCollection || targetIndex < 0) return serverCollections;
		const rest = dragSnapshot.filter((c) => c._id !== draggedCollection!._id);
		rest.splice(Math.min(targetIndex, rest.length), 0, draggedCollection);
		return rest;
	});

	function handleDragStart(collection: CollectionCard, e: PointerEvent) {
		if (!listElement) return;
		e.preventDefault();

		dragSnapshot = [...serverCollections];
		const index = dragSnapshot.findIndex((c) => c._id === collection._id);
		if (index === -1) return;

		slotRects = [...listElement.querySelectorAll('.card-wrapper')].map((el) =>
			el.getBoundingClientRect()
		);
		const rect = slotRects[index];

		draggedCollection = collection;
		targetIndex = index;
		dragOffset = { x: e.clientX - rect.left, y: e.clientY - rect.top };
		dragPosition = { x: e.clientX, y: e.clientY };
		dragWidth = rect.width;

		document.addEventListener('pointermove', handleDragMove);
		document.addEventListener('pointerup', handleDragEnd);
		document.body.style.cursor = 'grabbing';
		document.body.style.userSelect = 'none';
	}

	function handleDragMove(e: PointerEvent) {
		if (!draggedCollection) return;
		dragPosition = { x: e.clientX, y: e.clientY };

		// Target the slot whose center is nearest the cursor
		let nearest = targetIndex;
		let best = Infinity;
		for (let i = 0; i < slotRects.length; i++) {
			const rect = slotRects[i];
			const dx = e.clientX - (rect.left + rect.width / 2);
			const dy = e.clientY - (rect.top + rect.height / 2);
			const distance = dx * dx + dy * dy;
			if (distance < best) {
				best = distance;
				nearest = i;
			}
		}
		targetIndex = nearest;
	}

	function handleDragEnd() {
		const dragged = draggedCollection;
		const display = displayCollections;
		cleanup();
		if (!dragged) return;

		const index = display.findIndex((c) => c._id === dragged._id);
		const originalIndex = dragSnapshot.length
			? dragSnapshot.findIndex((c) => c._id === dragged._id)
			: serverCollections.findIndex((c) => c._id === dragged._id);
		if (index === -1 || index === originalIndex) return;

		const before = index > 0 ? display[index - 1] : null;
		const after = index < display.length - 1 ? display[index + 1] : null;

		const beforePos = before?.position ?? null;
		const afterPos = after?.position ?? null;
		if (beforePos !== null && afterPos !== null && beforePos >= afterPos) return;

		const newPosition = generateKeyBetween(beforePos, afterPos);
		mutate(writeToken, (token) =>
			client.mutation(api.collections.reorder, { id: dragged._id, newPosition, token })
		);
	}

	function cleanup() {
		draggedCollection = null;
		targetIndex = -1;
		slotRects = [];
		document.removeEventListener('pointermove', handleDragMove);
		document.removeEventListener('pointerup', handleDragEnd);
		document.body.style.cursor = '';
		document.body.style.userSelect = '';
	}

	// Cleanup drag listeners if component unmounts mid-drag
	onDestroy(() => {
		if (draggedCollection) {
			cleanup();
		}
	});
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
		<div class="list" bind:this={listElement}>
			{#each displayCollections as collection (collection._id)}
				<div class="card-wrapper" class:dragging={draggedCollection?._id === collection._id}>
					<a href="/collections/{collection._id}" class="clickable collection-card">
						<div class="info-row">
							<div class="collection-info">
								<h3>{collection.name}</h3>
								<p class="count">
									{collection.itemCount}
									{collection.itemCount === 1 ? 'item' : 'items'}
								</p>
							</div>
							<div class="actions">
								<button
									class="icon drag-handle"
									title="drag to reorder"
									onpointerdown={(e) => handleDragStart(collection, e)}
									onclick={(e) => {
										e.preventDefault();
										e.stopPropagation();
									}}>⠿</button
								>
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
						</div>
						{#if collection.previews?.length > 0}
							<div class="preview-row">
								{#each collection.previews as preview (preview._id)}
									<div class="thumb-wrapper">
										<img src={preview.imageUrl} alt="" class="preview-thumb" loading="lazy" />
									</div>
								{/each}
								{#each Array(Math.max(0, 4 - (collection.previews?.length || 0))) as _, i (i)}
									<div class="thumb-wrapper placeholder"></div>
								{/each}
							</div>
						{/if}
					</a>
				</div>
			{/each}
		</div>
	{/if}
</div>

{#if draggedCollection}
	<div
		class="drag-preview"
		style:left="{dragPosition.x - dragOffset.x}px"
		style:top="{dragPosition.y - dragOffset.y}px"
		style:width="{dragWidth}px"
	>
		<div class="clickable collection-card">
			<div class="info-row">
				<div class="collection-info">
					<h3>{draggedCollection.name}</h3>
					<p class="count">
						{draggedCollection.itemCount}
						{draggedCollection.itemCount === 1 ? 'item' : 'items'}
					</p>
				</div>
			</div>
			{#if draggedCollection.previews?.length > 0}
				<div class="preview-row">
					{#each draggedCollection.previews as preview (preview._id)}
						<div class="thumb-wrapper">
							<img src={preview.imageUrl} alt="" class="preview-thumb" />
						</div>
					{/each}
					{#each Array(Math.max(0, 4 - (draggedCollection.previews?.length || 0))) as _, i (i)}
						<div class="thumb-wrapper placeholder"></div>
					{/each}
				</div>
			{/if}
		</div>
	</div>
{/if}

{#if showCreateModal}
	<CollectionCreateModal onClose={() => (showCreateModal = false)} />
{/if}

<style>
	.list {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(20rem, 1fr));
		gap: var(--spacing);
	}
	.card-wrapper {
		display: flex;
	}
	.card-wrapper.dragging {
		opacity: 0.35;
		pointer-events: none;
	}
	.card-wrapper > a {
		width: 100%;
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
	.actions {
		display: flex;
		gap: 0.25rem;
		flex-shrink: 0;
	}
	.drag-handle {
		cursor: grab;
		opacity: 0;
		font-size: 1rem;
		line-height: 1;
		color: var(--txt-3);
		touch-action: none;
	}
	.collection-card:hover .drag-handle {
		opacity: 1;
	}
	.drag-handle:active {
		cursor: grabbing;
	}
	.drag-preview {
		position: fixed;
		pointer-events: none;
		z-index: 1000;
		opacity: 0.9;
		transform: rotate(2deg);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
	}
	.drag-preview .collection-card {
		background: var(--bg-1);
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
