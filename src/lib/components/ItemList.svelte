<script lang="ts">
	import { getContext } from 'svelte';
	import { page } from '$app/state';
	import { useConvexClient } from 'convex-svelte';
	import { api } from '../../convex/_generated/api.js';
	import type { Id } from '../../convex/_generated/dataModel.js';
	import { getImage } from '$lib/imageCache.svelte.js';
	import { mutate } from '$lib/mutationHelper.js';
	import IconSchedule from '~icons/material-symbols-light/schedule-outline';
	import IconError from '~icons/material-symbols-light/error-outline';
	import IconDelete from '~icons/material-symbols-light/delete-outline';
	import IconLink from '~icons/material-symbols-light/link';
	import IconText from '~icons/material-symbols-light/notes';
	import IconImage from '~icons/material-symbols-light/image-outline';
	import IconOpenInNew from '~icons/material-symbols-light/open-in-new';

	const client = useConvexClient();
	const getWriteToken = getContext<() => string | null>('writeToken');
	const writeToken = $derived(getWriteToken());

	interface Item {
		_id: Id<'items'>;
		type: 'url' | 'text' | 'image';
		title?: string;
		description?: string;
		url?: string;
		content?: string;
		imageUrl?: string | null;
		imageWidth?: number;
		imageHeight?: number;
		position?: string;
		screenshotStatus?: 'pending' | 'processing' | 'completed' | 'failed';
		screenshotError?: string;
	}

	interface Props {
		items: Item[];
		onRetryScreenshot?: (itemId: Id<'items'>) => void;
	}

	let { items, onRetryScreenshot }: Props = $props();

	async function handleDeleteItem(itemId: Id<'items'>, e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		await mutate(writeToken, (token) => client.mutation(api.items.remove, { id: itemId, token }));
	}

	function handleOpenLink(url: string, e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		window.open(url, '_blank', 'noopener,noreferrer');
	}

	function getItemUrl(itemId: Id<'items'>): string {
		const params = new URLSearchParams(page.url.searchParams);
		params.set('item', itemId);
		return `${page.url.pathname}?${params}`;
	}

	function shouldDisplayAsImage(item: Item): boolean {
		return (
			(item.type === 'image' || (item.type === 'url' && item.screenshotStatus === 'completed')) &&
			!!item.imageUrl
		);
	}

	function getDisplayText(item: Item): string {
		if (item.title) return item.title;
		if (item.url) return item.url;
		return 'Untitled';
	}
</script>

<div class="list">
	{#each items as item (item._id)}
		<div class="list-item-wrapper">
			<a href={getItemUrl(item._id)} class="list-item">
				<div class="thumbnail">
					{#if shouldDisplayAsImage(item)}
						<img src={getImage(item._id, item.imageUrl)} alt="" decoding="async" />
					{:else if item.type === 'url'}
						{#if item.screenshotStatus === 'pending' || item.screenshotStatus === 'processing'}
							<div class="icon-placeholder loading">
								<IconSchedule />
							</div>
						{:else if item.screenshotStatus === 'failed'}
							<div class="icon-placeholder error">
								<IconError />
							</div>
						{:else}
							<div class="icon-placeholder">
								<IconLink />
							</div>
						{/if}
					{:else if item.type === 'text'}
						<div class="icon-placeholder">
							<IconText />
						</div>
					{:else if item.type === 'image'}
						<div class="icon-placeholder">
							<IconImage />
						</div>
					{/if}
				</div>
				<span class="item-title">{getDisplayText(item)}</span>
				{#if item.description}
					<span class="item-description">{item.description}</span>
				{/if}
			</a>
			{#if item.url}
				<button class="icon link" title="Open link" onclick={(e) => handleOpenLink(item.url!, e)}>
					<IconOpenInNew />
				</button>
			{/if}
			<button
				class="icon delete"
				title="Delete item"
				onclick={(e) => handleDeleteItem(item._id, e)}
			>
				<IconDelete />
			</button>
		</div>
	{/each}
</div>

<style>
	.list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding-bottom: 2rem;
	}

	.list-item-wrapper {
		display: flex;
		align-items: center;
		border: 1px solid var(--border);
	}

	.list-item-wrapper:hover {
		background: var(--bg-2);
	}

	.list-item {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem;
		text-decoration: none;
		color: inherit;
	}

	.thumbnail {
		width: 2rem;
		height: 2rem;
		flex-shrink: 0;
		overflow: hidden;
		background: var(--bg-2);
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.thumbnail img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.icon-placeholder {
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--txt-3);
	}

	.icon-placeholder :global(svg) {
		width: 1.25rem;
		height: 1.25rem;
	}

	.icon-placeholder.loading {
		animation: pulse 2s ease-in-out infinite;
	}

	.icon-placeholder.error {
		color: var(--danger-border);
	}

	@keyframes pulse {
		0%,
		100% {
			color: var(--bg-3);
		}
		50% {
			color: var(--txt-3);
		}
	}

	.item-title {
		flex-shrink: 0;
		max-width: 40%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.item-description {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--txt-3);
	}

	.icon {
		margin-right: 0.5rem;
		padding: 0.25rem;
	}

	.icon.link {
		margin-right: 0.25rem;
	}

	.icon:hover {
		background-color: var(--bg-3);
	}

	.icon.delete:hover {
		background-color: var(--danger-bg);
	}

	.icon :global(svg) {
		width: 1.375rem;
		height: 1.375rem;
	}

	@media (max-width: 768px) {
		.list {
			padding-bottom: 4rem;
		}

		.item-title {
			flex: 1;
			max-width: none;
		}

		.item-description {
			display: none;
		}
	}
</style>
