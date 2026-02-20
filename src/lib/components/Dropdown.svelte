<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		label: string;
		icon: Snippet;
		content: Snippet<[() => void]>;
	}

	let { label, icon, content }: Props = $props();

	let open = $state(false);
	let containerEl: HTMLDivElement;

	function close() {
		open = false;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && open) {
			open = false;
		}
	}

	function handleClickOutside(e: MouseEvent) {
		if (open && containerEl && !containerEl.contains(e.target as Node)) {
			open = false;
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} onclick={handleClickOutside} />

<div class="dropdown-wrapper" bind:this={containerEl}>
	<button class="trigger" onclick={() => (open = !open)}>
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
		gap: 0.25rem;
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
		margin-top: 0.5rem;
		background: var(--bg-2);
		border: 1px solid var(--border);
		min-width: 10rem;
		max-height: 16rem;
		overflow-y: auto;
		z-index: 50;
		display: flex;
		flex-direction: column;
	}
</style>
