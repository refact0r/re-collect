<script lang="ts">
	import type { FeedCandidate } from '../../convex/discovery';
	import IconOpen from '~icons/material-symbols-light/open-in-new';
	import DiscoverMedia from './DiscoverMedia.svelte';
	import Modal from './Modal.svelte';

	interface Props {
		candidate: FeedCandidate;
		// Where it can be added: '' is the library alone, the last one used first
		options: { id: string; name: string }[];
		onAdd: (optionId: string) => void;
		onClose: () => void;
	}

	let { candidate, options, onAdd, onClose }: Props = $props();

	const domain = $derived.by(() => {
		try {
			return new URL(candidate.url).hostname.replace(/^www\./, '');
		} catch {
			return candidate.url;
		}
	});
</script>

<Modal {onClose} labelledby="discover-title">
	<div class="media">
		<DiscoverMedia {candidate} />
	</div>
	<h2 id="discover-title">{candidate.title || domain}</h2>
	<p class="meta">
		{candidate.sourceName} ·
		<a href={candidate.url} target="_blank" rel="noopener noreferrer">{domain} <IconOpen /></a>
	</p>

	<p class="meta label">add to</p>
	<div class="options">
		{#each options as option, i (option.id)}
			<!-- svelte-ignore a11y_autofocus -->
			<button onclick={() => onAdd(option.id)} autofocus={i === 0}>{option.name}</button>
		{/each}
	</div>
</Modal>

<style>
	.media {
		max-height: 60vh;
		overflow-y: auto;
		margin-bottom: 0.75rem;
	}

	h2 {
		margin: 0;
		overflow-wrap: anywhere;
	}

	.meta a {
		color: inherit;
		display: inline-flex;
		align-items: center;
		gap: 0.125rem;
	}

	.meta :global(svg) {
		width: 1rem;
		height: 1rem;
	}

	.label {
		margin-top: 1rem;
		margin-bottom: 0.5rem;
	}

	.options {
		display: flex;
		flex-direction: column;
		max-height: 14rem;
		overflow-y: auto;
		border: 1px solid var(--border);
	}

	.options button {
		justify-content: flex-start;
		border: none;
		background: transparent;
		padding: 0.5rem;
		text-align: left;
	}

	.options button + button {
		border-top: 1px solid var(--bg-3);
	}

	.options button:hover,
	.options button:focus-visible {
		background: var(--bg-3);
		color: var(--txt-1);
	}
</style>
