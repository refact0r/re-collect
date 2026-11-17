<script lang="ts">
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
</script>

<div class="list">
	{#each items as item (item._id)}
		{@const secondary =
			item.subject ?? item.ogDescription ?? (item.type === 'text' ? item.content : undefined)}
		<div class="list-item-wrapper">
			<a href={getItemUrl(item._id)} class="list-item">
				<div class="thumbnail">
					{#if shouldDisplayAsImage(item)}
						<img
							src={item.imageUrl}
							srcset={item.imageSrcset}
							sizes="2rem"
							alt=""
							decoding="async"
							loading="lazy"
						/>
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
				<span class="item-title">{item.title || item.url || 'untitled'}</span>
				{#if secondary}
					<span class="item-description">{secondary}</span>
				{/if}
			</a>
			{#if item.url && isWebUrl(item.url)}
				<button
					class="icon link"
					title="Open link"
					onclick={() => window.open(item.url, '_blank', 'noopener,noreferrer')}
				>
					<IconOpenInNew />
				</button>
			{/if}
			{#if !readonly}
				<button class="icon delete" title="Delete item" onclick={() => deleteItem(item._id)}>
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
		gap: var(--gap);
		padding-bottom: var(--space-2xl);
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
		gap: var(--gap);
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
		margin-right: var(--pad-x);
		padding: var(--pad-y-sm);
	}

	.icon.link {
		margin-right: var(--space-xs);
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
			padding-bottom: var(--toolbar-clearance);
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
