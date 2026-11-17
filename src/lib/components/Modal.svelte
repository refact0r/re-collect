<script lang="ts" module>
	// Open modals, innermost last: only it answers keys, so Escape on a
	// confirm over the item modal closes just the confirm
	const open: symbol[] = [];
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';

	interface Props {
		// Escape and a click on the backdrop
		onClose: () => void;
		// Any other key, e.g. the item modal's arrow navigation
		onkeydown?: (event: KeyboardEvent) => void;
		// 'wide' is the near-full-screen panel of the item editor and discover
		size?: 'narrow' | 'default' | 'wide';
		labelledby?: string;
		children: Snippet;
	}

	let { onClose, onkeydown, size = 'default', labelledby, children }: Props = $props();

	const self = Symbol();

	$effect(() => {
		open.push(self);
		return () => void open.splice(open.indexOf(self), 1);
	});

	let dialog: HTMLElement;

	function handleKeydown(event: KeyboardEvent) {
		if (open.at(-1) !== self || event.isComposing) return;
		if (event.key === 'Escape') onClose();
		else if (event.key === 'Tab') trapTab(event);
		else onkeydown?.(event);
	}

	// aria-modal keeps nothing in by itself: Tab would walk out to the page behind,
	// where focusing the header search navigates to /search
	function trapTab(event: KeyboardEvent) {
		const tabbable = [
			...dialog.querySelectorAll<HTMLElement>(
				'a[href], button, input, textarea, select, [tabindex]'
			)
		].filter(
			(el) =>
				el.tabIndex >= 0 &&
				!el.matches(':disabled') &&
				el.checkVisibility({ visibilityProperty: true })
		);
		const active = document.activeElement;
		const inside = active !== dialog && dialog.contains(active);
		const edge = event.shiftKey ? tabbable[0] : tabbable.at(-1);
		if (inside && edge && active !== edge) return;
		event.preventDefault();
		(event.shiftKey ? tabbable.at(-1) : tabbable[0])?.focus();
	}

	// A press that starts inside (selecting text, dragging a resize handle) and is
	// released on the backdrop clicks the backdrop too; only one that began there closes
	let pressedBackdrop = false;

	function handleBackdropClick(event: MouseEvent) {
		if (pressedBackdrop && event.target === event.currentTarget) onClose();
	}

	// Focus moves in (to an autofocus element, else the dialog) and returns on close.
	// Svelte's own autofocus only fires when nothing else has focus. Not on the way to
	// another page: it would land on the page being left (or the header search, which
	// then navigates to /search).
	function moveFocus(dialog: HTMLElement) {
		const previous = document.activeElement;
		const path = page.url.pathname;
		(dialog.querySelector<HTMLElement>('[autofocus]') ?? dialog).focus({ preventScroll: true });
		return () => {
			if (page.url.pathname !== path) return;
			if (previous instanceof HTMLElement && previous.isConnected) {
				previous.focus({ preventScroll: true });
			}
		};
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
	class={['backdrop', size]}
	onpointerdown={(event) => (pressedBackdrop = event.target === event.currentTarget)}
	onclick={handleBackdropClick}
	role="dialog"
	aria-modal="true"
	aria-labelledby={labelledby}
	tabindex="-1"
	bind:this={dialog}
	{@attach moveFocus}
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

	.backdrop:focus {
		outline: none;
	}

	.modal {
		background: var(--bg-1);
		border: 1px solid var(--border);
		padding: var(--modal-pad);
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
