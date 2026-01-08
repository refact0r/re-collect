<script lang="ts">
	import { SvelteMap } from 'svelte/reactivity';
	import type { Id } from '../../convex/_generated/dataModel.js';

	interface Item {
		_id: Id<'items'>;
		type: 'url' | 'text' | 'image';
		title?: string;
		url?: string;
		content?: string;
		imageUrl?: string | null;
		imageWidth?: number;
		imageHeight?: number;
	}

	interface Props {
		items: Item[];
	}

	let { items }: Props = $props();

	let containerElement: HTMLDivElement | undefined = $state();
	let containerWidth = $state(0);
	let urlCache = new SvelteMap<Id<'items'>, string>();

	// Cache image URLs and clean up stale entries
	$effect(() => {
		const currentIds = new Set(items.map((i) => i._id));

		// Clean up deleted items
		for (const id of urlCache.keys()) {
			if (!currentIds.has(id)) urlCache.delete(id);
		}

		// Cache URLs for new items
		for (const item of items) {
			if (item.type === 'image' && item.imageUrl && !urlCache.has(item._id)) {
				urlCache.set(item._id, item.imageUrl);
			}
		}
	});

	// Layout constants
	const GAP = 16;
	const MIN_COL_WIDTH = 320;
	const MAX_COLS = 6;
	const MIN_COLS = 1;

	// Card styling constants (should match CSS)
	const CARD_PADDING = 16; // 0.5rem × 2
	const CARD_BORDER = 2; // 1px × 2
	const CARD_CHROME = CARD_PADDING + CARD_BORDER;
	const TITLE_HEIGHT = 25; // 0.875rem line + 0.25rem top padding

	// Item type height constants
	const IMAGE_FALLBACK_ASPECT = 0.75;
	const TEXT_CARD_PADDING = 16;
	const TEXT_LINE_HEIGHT = 24;
	const TEXT_MAX_LINES = 10; // Based on -webkit-line-clamp in CSS
	const TEXT_CHAR_WIDTH = 7;
	const DEFAULT_HEIGHT = 100;

	let columnCount = $derived(
		containerWidth === 0
			? MIN_COLS
			: Math.min(
					MAX_COLS,
					Math.max(MIN_COLS, Math.floor((containerWidth + GAP) / (MIN_COL_WIDTH + GAP)))
				)
	);

	let columnWidth = $derived(
		columnCount <= MIN_COLS
			? containerWidth
			: (containerWidth - (columnCount - MIN_COLS) * GAP) / columnCount
	);

	function getItemHeight(item: Item): number {
		const titleHeight = item.title ? TITLE_HEIGHT : 0;

		if (item.type === 'image') {
			if (item.imageWidth && item.imageHeight) {
				const imageHeight = columnWidth * (item.imageHeight / item.imageWidth);
				return imageHeight + CARD_CHROME + titleHeight;
			}
			// Fallback for images without stored dimensions
			return columnWidth * IMAGE_FALLBACK_ASPECT + CARD_CHROME + titleHeight;
		}

		if (item.type === 'url' || item.type === 'text') {
			const content = item.type === 'url' ? (item.url ?? '') : (item.content ?? '');
			const lines = content.split('\n');

			// Calculate wrapped lines: each line might wrap based on width
			let totalLines = 0;
			const charsPerLine = Math.max(MIN_COLS, Math.floor(columnWidth / TEXT_CHAR_WIDTH));

			for (const line of lines) {
				if (line.length === 0) {
					totalLines += 1; // Empty line still takes space
				} else {
					totalLines += Math.ceil(line.length / charsPerLine);
				}
			}

			// Cap at max lines to match CSS line-clamp
			const displayLines = Math.min(totalLines, TEXT_MAX_LINES);
			const textHeight = displayLines * TEXT_LINE_HEIGHT + TEXT_CARD_PADDING;
			return textHeight + CARD_CHROME + titleHeight;
		}

		return DEFAULT_HEIGHT + titleHeight;
	}

	let columns = $derived.by(() => {
		if (columnCount === 0 || items.length === 0 || columnWidth === 0) return [];
		const cols: Item[][] = Array.from({ length: columnCount }, () => []);
		const heights = Array(columnCount).fill(0);
		for (const item of items) {
			const shortest = heights.indexOf(Math.min(...heights));
			cols[shortest].push(item);
			heights[shortest] += getItemHeight(item) + GAP;
		}
		return cols;
	});

	$effect(() => {
		if (!containerElement) return;
		const observer = new ResizeObserver((entries) => {
			containerWidth = entries[0].contentRect.width;
		});
		observer.observe(containerElement);
		return () => observer.disconnect();
	});
</script>

<div class="masonry" bind:this={containerElement}>
	{#each columns as column}
		<div class="column">
			{#each column as item (item._id)}
				<a href="?item={item._id}" class="card">
					{#if item.type === 'image' && item.imageUrl}
						<img
							src={urlCache.get(item._id) ?? item.imageUrl}
							alt={item.title ?? 'Image'}
							width={item.imageWidth}
							height={item.imageHeight}
							decoding="async"
						/>
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
	{/each}
</div>

<style>
	.masonry {
		display: flex;
		gap: 1rem;
		width: 100%;
	}

	.column {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		min-width: 0;
	}

	.card {
		border: 1px solid var(--border);
		padding: 0.5rem;
		display: block;
		text-decoration: none;
		color: inherit;
	}

	.card:hover {
		border-color: var(--txt-2);
	}

	.card img {
		width: 100%;
		display: block;
		height: auto;
	}

	.url-card,
	.text-card {
		padding: 0.5rem;
		background: var(--bg-2);
		word-break: break-all;
	}

	.text-card {
		overflow: auto;
		scrollbar-width: thin; /* Firefox: thin scrollbar */
		scrollbar-color: var(--bg-3) transparent; /* Firefox: thumb and track colors */
	}

	.text-card p {
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 10;
		margin: 0;
		white-space: pre-wrap;
	}

	.url-text {
		color: var(--txt-2);
	}

	.card-title {
		padding: 0.25rem 0 0 0;
		font-size: 0.875rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
