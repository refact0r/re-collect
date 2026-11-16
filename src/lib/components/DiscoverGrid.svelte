<script lang="ts">
	import type { FeedCandidate } from '../../convex/discovery';
	import { isWebUrl } from '../../convex/lib/urls.js';
	import { GAP, columnCountFor, columnWidthFor, fillColumns, gapOf } from '#lib/masonry.js';
	import DiscoverMedia, { FALLBACK_ASPECT, MAX_ASPECT } from './DiscoverMedia.svelte';

	interface Props {
		candidates: FeedCandidate[];
		columnOffset: number;
		onOpen: (candidate: FeedCandidate) => void;
	}

	let { candidates, columnOffset, onOpen }: Props = $props();

	// Card chrome as in ItemGrid's titled cards: --card-pad (8px) padding, --space-xs (4px)
	// below the title line, 1px border
	const CHROME_X = 18;
	const CHROME_Y = 14 + 25;

	let grid: HTMLDivElement | undefined = $state();
	let width = $state(0);
	// Read again whenever the width changes, which it does when the gap does
	const gap = $derived(grid && width ? gapOf(grid) : GAP);
	const columnCount = $derived(columnCountFor(width, columnOffset, gap));
	const columnWidth = $derived(columnWidthFor(width, columnCount, gap));

	// Each card goes into the shortest column, so the feed reads across in rows
	const columns = $derived.by(() => {
		const heights = candidates.map((candidate) => {
			const aspect =
				candidate.imageWidth && candidate.imageHeight
					? candidate.imageHeight / candidate.imageWidth
					: FALLBACK_ASPECT;
			return (columnWidth - CHROME_X) * Math.min(aspect, MAX_ASPECT) + CHROME_Y;
		});
		const cols: FeedCandidate[][] = Array.from({ length: columnCount }, () => []);
		const fill = fillColumns(heights, columnCount, gap);
		candidates.forEach((candidate, i) => cols[fill.columns[i]].push(candidate));
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

<div class="masonry" bind:this={grid} bind:clientWidth={width}>
	{#each columns as column, i (i)}
		<div class="column">
			{#each column as candidate (candidate._id)}
				<a
					class="clickable card"
					href={isWebUrl(candidate.url) ? candidate.url : undefined}
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
		gap: var(--gutter);
		width: 100%;
	}

	.column {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: var(--gutter);
		min-width: 0;
	}

	.card {
		padding: var(--card-pad) var(--card-pad) var(--space-xs);
	}

	.caption {
		display: flex;
		gap: var(--gap);
		padding-top: var(--space-xs);
		font-size: var(--text-sm);
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
