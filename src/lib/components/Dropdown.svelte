<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		label: string;
		title?: string;
		icon: Snippet;
		content: Snippet<[() => void]>;
	}

	let { label, title, icon, content }: Props = $props();

	let open = $state(false);
	let containerEl: HTMLDivElement;

	function close() {
		open = false;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') close();
	}

	function handleClickOutside(e: MouseEvent) {
		if (!containerEl.contains(e.target as Node)) close();
	}
</script>

<svelte:window onkeydown={handleKeydown} onclick={handleClickOutside} />

<div class="dropdown-wrapper" bind:this={containerEl}>
	<button class="trigger" {title} onclick={() => (open = !open)}>
		{@render icon()}
		{label}
	</button>
	{#if open}
		<div class="dropdown">
			{@render content(close)}
		</div>
	{/if}
</div>

<style>
	.dropdown-wrapper {
		position: relative;
	}

	.trigger {
		gap: var(--gap-sm);
	}

	.trigger :global(svg) {
		width: 1.25rem;
		height: 1.25rem;
		flex-shrink: 0;
	}

	.dropdown {
		position: absolute;
		top: 100%;
		right: 0;
		margin-top: var(--space-md);
		background: var(--bg-2);
		border: 1px solid var(--border);
		min-width: 10rem;
		max-height: 16rem;
		overflow-y: auto;
		z-index: 50;
		display: flex;
		flex-direction: column;
	}

	/* Checkbox rows, as in the collection and source filters */
	.dropdown :global(label.option) {
		display: flex;
		align-items: center;
		gap: var(--gap);
		padding: var(--pad-y) var(--pad-x);
		cursor: pointer;
		white-space: nowrap;
	}

	.dropdown :global(label.option:hover) {
		background: var(--bg-3);
		color: var(--txt-1);
	}
</style>
