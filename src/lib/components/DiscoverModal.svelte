<script lang="ts">
	import type { FeedCandidate } from '../../convex/discovery';
	import { isWebUrl } from '../../convex/lib/urls.js';
	import IconArrow from '~icons/material-symbols-light/arrow-forward';
	import IconOpenInNew from '~icons/material-symbols-light/open-in-new-sharp';
	import DiscoverMedia from './DiscoverMedia.svelte';
	import Modal from './Modal.svelte';

	interface Props {
		candidate: FeedCandidate;
		// Where it can be added: '' is the library alone (uncollected), the last one used first
		options: { id: string; name: string; count?: number }[];
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

<Modal {onClose} labelledby="discover-title" size="wide">
	<div class="layout">
		<div class="media">
			<DiscoverMedia {candidate} />
		</div>
		<div class="side">
			<div>
				<h2 id="discover-title">{candidate.title || 'untitled'}</h2>
				<p class="meta">
					{candidate.sourceName} ·
					<a
						href={isWebUrl(candidate.url) ? candidate.url : undefined}
						target="_blank"
						rel="noopener noreferrer"
					>
						{domain}
						<IconOpenInNew />
					</a>
				</p>
			</div>

			<div class="add">
				<p class="meta">add to</p>
				<div class="options">
					{#each options as option, i (option.id)}
						<!-- svelte-ignore a11y_autofocus -->
						<button onclick={() => onAdd(option.id)} autofocus={i === 0}>
							<span class="name">{option.name}</span>
							<!-- The count gives way to an arrow on hover: this is where it goes -->
							<span class="end">
								<span class="count">{option.count ?? ''}</span>
								<IconArrow />
							</span>
						</button>
					{/each}
				</div>
			</div>

			<button class="cancel" onclick={onClose}>cancel</button>
		</div>
	</div>
</Modal>

<style>
	.layout {
		display: flex;
		gap: var(--space-xl);
		height: 100%;
	}

	/* Media is shown whole, scaled to fit the pane */
	.media {
		flex: 1;
		min-width: 0;
		display: grid;
		place-items: center;
		container-type: size;
	}

	.media :global(:is(img, video)) {
		width: 100cqw;
		height: 100cqh;
		object-fit: contain;
	}

	/* The divider runs through the modal's padding, edge to edge */
	.side {
		width: 20rem;
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-xl);
		min-height: 0;
		margin-block: calc(-1 * var(--modal-pad));
		padding: var(--modal-pad) 0 var(--modal-pad) var(--modal-pad);
		border-left: 1px solid var(--border);
	}

	h2 {
		margin: 0;
		overflow-wrap: anywhere;
	}

	.meta a {
		color: inherit;
		display: inline-flex;
		align-items: center;
		gap: var(--space-2xs);
	}

	.meta :global(svg) {
		width: 1rem;
		height: 1rem;
	}

	/* The list takes the column's spare height and scrolls only past it */
	.add {
		display: flex;
		flex-direction: column;
		gap: var(--gap);
		min-height: 0;
	}

	.options {
		display: flex;
		flex-direction: column;
		min-height: 0;
		overflow-y: auto;
		border: 1px solid var(--border);
	}

	.options button {
		flex-shrink: 0;
		justify-content: space-between;
		gap: var(--gap);
		border: none;
		background: transparent;
		padding: var(--pad-y) var(--pad-x);
		text-align: left;
	}

	.name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* Count and arrow share one slot, right-aligned */
	.end {
		display: grid;
		justify-items: end;
		align-items: center;
		flex-shrink: 0;
	}

	.end > :global(*) {
		grid-area: 1 / 1;
		transition: opacity 0.1s;
	}

	.count {
		font-size: var(--text-sm);
		color: var(--txt-3);
	}

	.end :global(svg) {
		width: 1.25rem;
		height: 1.25rem;
		opacity: 0;
	}

	.options button:hover .count,
	.options button:focus-visible .count {
		opacity: 0;
	}

	.options button:hover .end :global(svg),
	.options button:focus-visible .end :global(svg) {
		opacity: 1;
	}

	.options button + button {
		border-top: 1px solid var(--bg-3);
	}

	.options button:hover,
	.options button:focus-visible {
		background: var(--bg-3);
		color: var(--txt-1);
	}

	.cancel {
		margin-top: auto;
		flex-shrink: 0;
	}

	/* The wide modal is full-screen here: stack, and the whole sheet scrolls */
	@media (max-width: 768px) {
		.layout {
			flex-direction: column;
			height: auto;
			padding: var(--modal-pad);
		}

		.media {
			display: block;
			container-type: normal;
		}

		.media :global(:is(img, video)) {
			width: 100%;
			height: auto;
			max-height: 70vh;
		}

		.side {
			width: auto;
			margin: 0 calc(-1 * var(--modal-pad));
			padding: var(--modal-pad) var(--modal-pad) 0;
			border-left: none;
			border-top: 1px solid var(--border);
		}

		.options {
			overflow-y: visible;
		}
	}
</style>
