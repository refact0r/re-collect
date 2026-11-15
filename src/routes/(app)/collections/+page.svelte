<script lang="ts">
	import { onDestroy } from 'svelte';
	import { generateKeyBetween } from 'fractional-indexing';
	import { api } from '../../../convex/_generated/api.js';
	import type { Id } from '../../../convex/_generated/dataModel.js';
	import CollectionCreateModal from '#lib/components/CollectionCreateModal.svelte';
	import { confirmAction } from '#lib/confirm.svelte.js';
	import { useMutation } from '#lib/convex.js';
	import { pointerDrag } from '#lib/pointerDrag.js';
	import { getCollectionsContext, type CollectionsData } from '#lib/context.js';
	import IconDelete from '~icons/material-symbols-light/delete-outline-sharp';

	type CollectionCard = CollectionsData[number];

	const mutate = useMutation();
	const collections = getCollectionsContext();

	let showCreateModal = $state(false);

	async function handleDelete(id: Id<'collections'>) {
		const ok = await confirmAction({
			title: 'delete this collection?',
			message: 'its items stay in your library.',
			action: 'delete',
			danger: true
		});
		if (ok) mutate(api.collections.remove, { id });
	}

	// ============ DRAG REORDERING ============
	const serverCollections = $derived(collections.data ?? []);

	let listElement: HTMLElement | undefined = $state();
	let draggedCollection: CollectionCard | null = $state(null);
	let targetIndex = $state(-1);
	let previewPosition = $state({ x: 0, y: 0 });
	let previewWidth = $state(0);
	let cancelDrag: (() => void) | null = null;

	// Taken at drag start. Slot centers are relative to the list, so they survive
	// scrolling, and stay fixed while cards swap between them.
	let drag: {
		offset: { x: number; y: number }; // pointer position within the card
		order: CollectionCard[];
		slotCenters: { x: number; y: number }[];
	} | null = null;

	const displayCollections = $derived.by(() => {
		if (!draggedCollection || !drag) return serverCollections;
		const rest = drag.order.filter((c) => c._id !== draggedCollection!._id);
		rest.splice(targetIndex, 0, draggedCollection);
		return rest;
	});

	function handlePointerDown(collection: CollectionCard, e: PointerEvent) {
		const card = e.currentTarget as HTMLElement;
		cancelDrag = pointerDrag(e, {
			start: (x, y) => handleDragStart(collection, card, x, y),
			move: handleDragMove,
			end: handleDragEnd
		});
	}

	function handleDragStart(collection: CollectionCard, card: HTMLElement, x: number, y: number) {
		if (!listElement) return;
		const listRect = listElement.getBoundingClientRect();
		const rect = card.getBoundingClientRect();
		drag = {
			offset: { x: x - rect.left, y: y - rect.top },
			order: [...serverCollections],
			slotCenters: [...listElement.querySelectorAll('.collection-card')].map((el) => {
				const slot = el.getBoundingClientRect();
				return {
					x: slot.left - listRect.left + slot.width / 2,
					y: slot.top - listRect.top + slot.height / 2
				};
			})
		};
		draggedCollection = collection;
		targetIndex = drag.order.findIndex((c) => c._id === collection._id);
		previewPosition = { x: rect.left, y: rect.top };
		previewWidth = rect.width;
	}

	// Also runs when the page scrolls under a still pointer, so the target follows the content
	function handleDragMove(x: number, y: number) {
		if (!drag || !listElement) return;
		previewPosition = { x: x - drag.offset.x, y: y - drag.offset.y };

		// Target the slot whose center is nearest the cursor
		const listRect = listElement.getBoundingClientRect();
		const distance = ({ x: sx, y: sy }: { x: number; y: number }) =>
			(x - listRect.left - sx) ** 2 + (y - listRect.top - sy) ** 2;
		const { slotCenters } = drag;
		targetIndex = slotCenters.reduce(
			(best, slot, i) => (distance(slot) < distance(slotCenters[best]) ? i : best),
			0
		);
	}

	function handleDragEnd(commit: boolean) {
		const dragged = draggedCollection;
		const original = drag?.order ?? [];
		const display = displayCollections;
		draggedCollection = null;
		drag = null;
		cancelDrag = null;
		if (!commit || !dragged) return;

		const index = display.findIndex((c) => c._id === dragged._id);
		if (index === original.findIndex((c) => c._id === dragged._id)) return;

		const beforePos = display[index - 1]?.position ?? null;
		const afterPos = display[index + 1]?.position ?? null;
		// fractional-indexing needs before < after
		if (beforePos !== null && afterPos !== null && beforePos >= afterPos) return;

		const newPosition = generateKeyBetween(beforePos, afterPos);
		mutate(api.collections.reorder, { id: dragged._id, newPosition });
	}

	// Drop the drag's document listeners if the page unmounts mid-drag
	onDestroy(() => cancelDrag?.());
</script>

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
			<a
				href="/collections/{collection._id}"
				class="clickable set-card collection-card"
				class:dragging={draggedCollection?._id === collection._id}
				onpointerdown={(e) => handlePointerDown(collection, e)}
			>
				{@render cardBody(collection, true)}
			</a>
		{/each}
	</div>
{/if}

{#snippet cardBody(collection: CollectionCard, withActions: boolean)}
	<div class="info-row">
		<div class="collection-info">
			<h3>{collection.name}</h3>
			<p class="count">
				{collection.itemCount}
				{collection.itemCount === 1 ? 'item' : 'items'}
			</p>
		</div>
		{#if withActions}
			<div class="actions">
				<button
					class="icon danger"
					aria-label="delete collection"
					onclick={(e) => {
						e.preventDefault();
						e.stopPropagation();
						handleDelete(collection._id);
					}}
				>
					<IconDelete />
				</button>
			</div>
		{/if}
	</div>
	<div class="mosaic">
		{#each collection.previews as preview (preview._id)}
			<img src={preview.imageUrl} alt="" loading="lazy" />
		{/each}
		{#each Array(Math.max(0, 6 - collection.previews.length)) as _, i (i)}
			<div></div>
		{/each}
	</div>
{/snippet}

{#if draggedCollection}
	<div
		class="drag-preview"
		style:transform="translate3d({previewPosition.x}px, {previewPosition.y}px, 0) rotate(2deg)"
		style:width="{previewWidth}px"
	>
		<div class="clickable set-card collection-card">
			{@render cardBody(draggedCollection, false)}
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
		gap: var(--gutter);
	}
	.collection-card.dragging {
		opacity: 0.35;
		pointer-events: none;
	}
	.collection-card:has(button:hover) {
		background-color: transparent;
	}
	.info-row {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: var(--gutter);
	}
	.collection-info h3 {
		margin: 0;
	}
	.count {
		font-size: var(--text-sm);
		color: var(--txt-3);
		margin: var(--space-xs) 0 0 0;
	}
	.actions {
		display: flex;
		gap: var(--gap-sm);
		flex-shrink: 0;
	}
	.drag-preview {
		position: fixed;
		top: 0;
		left: 0;
		pointer-events: none;
		z-index: 1000;
		opacity: 0.9;
		will-change: transform;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
	}
	.drag-preview .collection-card {
		background: var(--bg-1);
	}
</style>
