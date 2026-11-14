<script lang="ts">
	import type { FeedCandidate } from '../../convex/discovery';
	import { GAP, columnCountFor, columnWidthFor } from '#lib/masonry.js';
	import DiscoverMedia, { MAX_ASPECT } from './DiscoverMedia.svelte';

	interface Props {
		candidates: FeedCandidate[];
		columnOffset: number;
		onOpen: (candidate: FeedCandidate) => void;
	}

	let { candidates, columnOffset, onOpen }: Props = $props();

	// Card chrome as in ItemGrid's titled cards: 8px padding, 4px below the
	// title line, 1px border
	const CHROME_X = 18;
	const CHROME_Y = 14 + 25;
	const FALLBACK_ASPECT = 0.75;

	let width = $state(0);
	const columnCount = $derived(columnCountFor(width, columnOffset));
	const columnWidth = $derived(columnWidthFor(width, columnCount));

	// Each card goes into the shortest column, so the feed reads across in rows
	const columns = $derived.by(() => {
		const cols: FeedCandidate[][] = Array.from({ length: columnCount }, () => []);
		const heights: number[] = Array(columnCount).fill(0);
		for (const candidate of candidates) {
			const aspect =
				candidate.imageWidth && candidate.imageHeight
					? candidate.imageHeight / candidate.imageWidth
					: FALLBACK_ASPECT;
			const col = heights.indexOf(Math.min(...heights));
			cols[col].push(candidate);
			heights[col] += (columnWidth - CHROME_X) * Math.min(aspect, MAX_ASPECT) + CHROME_Y + GAP;
		}
		return cols;
	});

	// A plain click opens the card here; modified clicks still open the original
	function open(event: MouseEvent, candidate: FeedCandidate) {
		if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
			return;
		}
		event.preventDefault();
		onOpen(candidate);
	}
</script>

<div class="masonry" bind:clientWidth={width}>
	{#each columns as column, i (i)}
		<div class="column">
			{#each column as candidate (candidate._id)}
				<a
					class="clickable card"
					href={candidate.url}
					target="_blank"
					rel="noopener noreferrer"
					onclick={(e) => open(e, candidate)}
				>
					<DiscoverMedia {candidate} cropped />
					<div class="caption">
						{#if candidate.title}<span class="title">{candidate.title}</span>{/if}
						<span class="source">{candidate.from}</span>
					</div>
				</a>
			{/each}
		</div>
	{/each}
</div>

<style>
	.masonry {
		display: flex;
		gap: var(--spacing);
		width: 100%;
	}

	.column {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: var(--spacing);
		min-width: 0;
	}

	.card {
		padding: 0.5rem 0.5rem 0.25rem;
	}

	.caption {
		display: flex;
		gap: 0.5rem;
		padding-top: 0.25rem;
		font-size: 0.875rem;
		line-height: 1.5;
		white-space: nowrap;
	}

	.title {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.source {
		margin-left: auto;
		flex-shrink: 0;
		color: var(--txt-3);
	}
</style>
