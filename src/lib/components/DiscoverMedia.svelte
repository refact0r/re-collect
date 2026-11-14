<script lang="ts" module>
	// Grid cards crop very tall pages and posters from the top at this height / width
	export const MAX_ASPECT = 2;
</script>

<script lang="ts">
	import type { FeedCandidate } from '../../convex/discovery';

	interface Props {
		candidate: FeedCandidate;
		// A grid card: tall media is cropped rather than shown whole
		cropped?: boolean;
	}

	let { candidate, cropped = false }: Props = $props();

	const aspect = $derived.by(() => {
		const { imageWidth: w, imageHeight: h } = candidate;
		if (!w || !h) return undefined;
		return `${w} / ${cropped ? Math.min(h, w * MAX_ASPECT) : h}`;
	});

	// Loops play only while on screen
	function playWhenVisible(video: HTMLVideoElement) {
		const observer = new IntersectionObserver(
			([entry]) => {
				if (entry.isIntersecting) video.play().catch(() => {});
				else video.pause();
			},
			{ threshold: 0.25 }
		);
		observer.observe(video);
		return () => observer.disconnect();
	}
</script>

{#if candidate.videoUrl}
	<video
		class:cropped
		src={candidate.videoUrl}
		poster={candidate.imageUrl}
		muted
		loop
		playsinline
		preload="none"
		style:aspect-ratio={aspect}
		{@attach playWhenVisible}
	></video>
{:else}
	<img
		class:cropped
		src={candidate.imageUrl}
		alt={candidate.title ?? ''}
		loading="lazy"
		decoding="async"
		style:aspect-ratio={aspect}
		referrerpolicy="no-referrer"
	/>
{/if}

<style>
	img,
	video {
		display: block;
		width: 100%;
		height: auto;
		background: var(--bg-2);
	}

	.cropped {
		object-fit: cover;
		object-position: top;
	}
</style>
