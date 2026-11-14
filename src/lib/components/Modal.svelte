<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		// Escape and a click on the backdrop
		onClose: () => void;
		// Any other key, e.g. the item modal's arrow navigation
		onkeydown?: (event: KeyboardEvent) => void;
		// 'wide' is the full-size panel the item editor fills
		size?: 'narrow' | 'default' | 'wide';
		labelledby?: string;
		children: Snippet;
	}

	let { onClose, onkeydown, size = 'default', labelledby, children }: Props = $props();

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') onClose();
		else onkeydown?.(event);
	}

	function handleBackdropClick(event: MouseEvent) {
		if (event.target === event.currentTarget) onClose();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
	class={['backdrop', size]}
	onclick={handleBackdropClick}
	role="dialog"
	aria-modal="true"
	aria-labelledby={labelledby}
	tabindex="-1"
>
	<div class={['modal', size]}>
		{@render children()}
	</div>
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		background: oklch(from var(--bg-1) l c h / 0.5);
		backdrop-filter: blur(5px);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
	}

	.modal {
		background: var(--bg-1);
		border: 1px solid var(--border);
		padding: 1rem;
		max-width: 32rem;
		width: 100%;
		max-height: calc(100vh - 4rem);
		overflow-y: auto;
		position: relative;
	}

	.modal.narrow {
		max-width: 24rem;
	}

	.modal.wide {
		max-width: calc(100vw - 4rem);
		height: calc(100vh - 4rem);
		overflow: hidden;
	}

	@media (max-width: 768px) {
		.backdrop.wide {
			align-items: flex-start;
		}

		.modal.wide {
			height: 100vh;
			max-height: 100vh;
			overflow-y: auto;
			width: 100vw;
			max-width: 100vw;
			border: none;
			padding: 0;
		}
	}
</style>
