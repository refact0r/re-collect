<script lang="ts">
	import type { Id } from '../../convex/_generated/dataModel.js';

	interface Item {
		_id: Id<'items'>;
		type: 'url' | 'text' | 'image';
		title?: string;
		url?: string;
		content?: string;
		imageUrl?: string | null;
	}

	interface Props {
		items: Item[];
	}

	let { items }: Props = $props();
</script>

<div class="grid">
	{#each items as item (item._id)}
		<a href="?item={item._id}" class="card">
			{#if item.type === 'image' && item.imageUrl}
				<img src={item.imageUrl} alt={item.title ?? 'Image'} />
			{:else if item.type === 'url'}
				<div class="url-card">
					<span class="url-text">{item.url}</span>
				</div>
			{:else if item.type === 'text'}
				<div class="text-card">
					<p>{item.content}</p>
				</div>
			{/if}
			{#if item.title}
				<div class="card-title">{item.title}</div>
			{/if}
		</a>
	{/each}
</div>

<style>
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
		gap: 1rem;
	}
	.card {
		border: 1px solid var(--border);
		padding: 0.5rem;
		break-inside: avoid;
		display: block;
		text-decoration: none;
		color: inherit;
		transition: all 0.2s;
	}
	.card:hover {
		border-color: var(--txt-2);
		background: var(--bg-2);
	}
	.card img {
		width: 100%;
		display: block;
	}
	.url-card,
	.text-card {
		padding: 1rem;
		background: var(--bg-2);
		word-break: break-all;
	}
	.url-text {
		color: var(--txt-2);
	}
	.card-title {
		padding: 0.5rem 0;
		font-size: 0.875rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
