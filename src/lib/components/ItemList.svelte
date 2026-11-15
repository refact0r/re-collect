<script lang="ts">
	import type { Id } from '../../convex/_generated/dataModel.js';
	import { useDeleteItem } from '#lib/convex.js';
	import { shouldDisplayAsImage, getItemUrl, isBusy } from '#lib/itemDisplay.js';
	import { isWebUrl } from '../../convex/lib/urls.js';
	import type { DisplayItem } from '#lib/types.js';
	import IconSchedule from '~icons/material-symbols-light/schedule-outline-sharp';
	import IconError from '~icons/material-symbols-light/error-outline-sharp';
	import IconDelete from '~icons/material-symbols-light/delete-outline-sharp';
	import IconLink from '~icons/material-symbols-light/link-sharp';
	import IconText from '~icons/material-symbols-light/notes-sharp';
	import IconImage from '~icons/material-symbols-light/image-outline-sharp';
	import IconOpenInNew from '~icons/material-symbols-light/open-in-new-sharp';

	const deleteItem = useDeleteItem();

	interface Props {
		items: DisplayItem[];
		// Someone else's items (a shared collection): no delete
		readonly?: boolean;
	}

	let { items, readonly = false }: Props = $props();

	function handleDeleteItem(itemId: Id<'items'>, e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		deleteItem(itemId);
	}

	function handleOpenLink(url: string, e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		window.open(url, '_blank', 'noopener,noreferrer');
	}

	function getDisplayText(item: DisplayItem): string {
		if (item.title) return item.title;
		if (item.url) return item.url;
		return 'untitled';
	}

	// Secondary line: AI summary, else captured og:description; text items
	// show their own content
	function getSecondaryText(item: DisplayItem): string | undefined {
		return item.subject ?? item.ogDescription ?? (item.type === 'text' ? item.content : undefined);
	}
</script>

<div class="list">
	{#each items as item (item._id)}
		<div class="list-item-wrapper">
			<a href={getItemUrl(item._id)} class="list-item">
				<div class="thumbnail">
					{#if shouldDisplayAsImage(item)}
						<img src={item.imageUrl} alt="" decoding="async" loading="lazy" />
					{:else if item.type === 'url'}
						{#if isBusy(item.screenshotStatus)}
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
				{#if getSecondaryText(item)}
					<span class="item-description">{getSecondaryText(item)}</span>
				{/if}
			</a>
			{#if item.url && isWebUrl(item.url)}
				<button class="icon link" title="Open link" onclick={(e) => handleOpenLink(item.url!, e)}>
					<IconOpenInNew />
				</button>
			{/if}
			{#if !readonly}
				<button
					class="icon delete"
					title="Delete item"
					onclick={(e) => handleDeleteItem(item._id, e)}
				>
					<IconDelete />
				</button>
			{/if}
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
		padding: var(--pad-y) var(--pad-x);
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
