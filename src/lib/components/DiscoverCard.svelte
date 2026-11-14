<script lang="ts">
	import type { FeedCandidate } from '../../convex/discovery';
	import IconClose from '~icons/material-symbols-light/close';
	import IconKeep from '~icons/material-symbols-light/bookmark-add-outline';

	interface Props {
		candidate: FeedCandidate;
		focused: boolean;
		// The keep picker is open on this card
		picking: boolean;
		keepOptions: { id: string; name: string }[];
		onKeep: () => void;
		onPick: (optionId: string) => void;
		onSkip: () => void;
		onFocus: () => void;
	}

	let { candidate, focused, picking, keepOptions, onKeep, onPick, onSkip, onFocus }: Props =
		$props();

	const domain = $derived.by(() => {
		try {
			return new URL(candidate.url).hostname.replace(/^www\./, '');
		} catch {
			return '';
		}
	});

	const age = $derived(relativeDate(candidate.publishedAt));

	function relativeDate(ms: number) {
		const days = Math.floor((Date.now() - ms) / 86_400_000);
		if (days < 1) return 'today';
		if (days < 2) return 'yesterday';
		if (days < 30) return `${days}d ago`;
		if (days < 365) return `${Math.floor(days / 30)}mo ago`;
		return `${Math.floor(days / 365)}y ago`;
	}

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

	const aspect = $derived(
		candidate.imageWidth && candidate.imageHeight
			? `${candidate.imageWidth} / ${candidate.imageHeight}`
			: undefined
	);
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions, a11y_click_events_have_key_events -->
<article class:focused onclick={onFocus} data-candidate={candidate._id}>
	<a
		class="media"
		href={candidate.url}
		target="_blank"
		rel="noopener noreferrer"
		style:aspect-ratio={aspect}
	>
		{#if candidate.videoUrl}
			<video
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
				src={candidate.imageUrl}
				alt={candidate.title ?? ''}
				loading="lazy"
				style:aspect-ratio={aspect}
				referrerpolicy="no-referrer"
			/>
		{/if}
	</a>

	<div class="body">
		<div class="meta-row">
			<span class="source">{candidate.sourceName}</span>
			<span>·</span>
			<span>{age}</span>
			{#if domain}
				<span>·</span>
				<span class="domain">{domain}</span>
			{/if}
		</div>

		{#if candidate.title}
			<a class="title" href={candidate.url} target="_blank" rel="noopener noreferrer"
				>{candidate.title}</a
			>
		{/if}
		{#if candidate.author}
			<span class="author">{candidate.author}</span>
		{/if}
		{#if candidate.description}
			<p class="description">{candidate.description}</p>
		{/if}
		{#if candidate.tags?.length}
			<div class="tags">
				{#each candidate.tags.slice(0, 6) as tag (tag)}
					<span class="tag">{tag}</span>
				{/each}
			</div>
		{/if}

		<div class="actions">
			<button onclick={onSkip} title="skip (x)"><IconClose /> skip</button>
			<button class="keep" class:active={picking} onclick={onKeep} title="keep (s)"
				><IconKeep /> keep</button
			>
		</div>
		{#if picking}
			<div class="picker" role="menu" aria-label="keep to">
				{#each keepOptions as option, i (option.id)}
					<button role="menuitem" onclick={() => onPick(option.id)}>
						<span class="hint">{i < 9 ? i + 1 : ''}</span>
						{option.name}
					</button>
				{/each}
			</div>
		{/if}
	</div>
</article>

<style>
	article {
		border: 1px solid var(--border);
		background: var(--bg-2);
		break-inside: avoid;
		margin-bottom: var(--spacing);
		transition: border-color 0.15s;
	}
	article.focused {
		border-color: var(--txt-3);
	}
	.media {
		display: block;
		background: var(--bg-3);
	}
	/* Very tall pages and posters are cropped from the top */
	.media img,
	.media video {
		display: block;
		width: 100%;
		max-height: 80vh;
		object-fit: cover;
		object-position: top;
	}
	.body {
		padding: 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.meta-row {
		display: flex;
		gap: 0.375rem;
		font-size: 0.8125rem;
		color: var(--txt-3);
		min-width: 0;
	}
	.source {
		color: var(--txt-2);
		white-space: nowrap;
	}
	.domain {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.title {
		color: var(--txt-1);
		text-decoration: none;
		font-weight: 500;
		font-size: 1.0625rem;
	}
	.title:hover {
		text-decoration: underline;
	}
	.author {
		font-size: 0.875rem;
		color: var(--txt-3);
	}
	.description {
		font-size: 0.9375rem;
		display: -webkit-box;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.tags {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		margin-top: 0.25rem;
	}
	.tag {
		font-size: 0.75rem;
		padding: 0 0.375rem;
		border: 1px solid var(--border);
		color: var(--txt-3);
	}
	.actions {
		display: flex;
		gap: 0.5rem;
		margin-top: 0.5rem;
	}
	.actions button {
		flex: 1;
		padding: 0.375rem;
	}
	.actions :global(svg) {
		width: 1.25rem;
		height: 1.25rem;
	}
	.keep:hover,
	.keep.active {
		border-color: var(--txt-3);
	}
	.picker {
		display: flex;
		flex-direction: column;
		border: 1px solid var(--border);
		max-height: 16rem;
		overflow-y: auto;
	}
	.picker button {
		justify-content: flex-start;
		border: none;
		background: transparent;
		padding: 0.375rem 0.5rem;
		text-align: left;
	}
	.picker button:first-child {
		background: var(--bg-3);
	}
	.picker button:hover {
		background: var(--bg-3);
	}
	.hint {
		width: 1rem;
		font-size: 0.75rem;
		color: var(--txt-3);
	}
</style>
