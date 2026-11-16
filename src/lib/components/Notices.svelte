<script lang="ts">
	import { dismiss, notices } from '#lib/notice.svelte.js';
</script>

<!-- The live regions stay in the page, so screen readers hear what's added to them:
	errors at once, the rest when idle -->
<div class="notices">
	<div role="alert">
		{@render list(true)}
	</div>
	<div role="status">
		{@render list(false)}
	</div>
</div>

{#snippet list(error: boolean)}
	{#each notices.filter((n) => n.error === error) as notice (notice.id)}
		<!-- A click is a shortcut: every notice also goes by itself -->
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div class={['notice', { error }]} onclick={() => dismiss(notice.id)}>
			<span>{notice.text}</span>
			{#if notice.link}<a href={notice.link.href}>{notice.link.label}</a>{/if}
		</div>
	{/each}
{/snippet}

<style>
	.notices {
		position: fixed;
		bottom: 1.5rem;
		left: 50%;
		transform: translateX(-50%);
		width: max-content;
		max-width: calc(100vw - 2 * var(--gutter));
		/* above modals and drag previews */
		z-index: 1100;
		pointer-events: none;
	}

	.notices,
	.notices > div {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--gap-sm);
	}

	.notice {
		display: flex;
		align-items: center;
		gap: var(--space-lg);
		padding: var(--space-md) var(--space-lg);
		background: var(--bg-2);
		border: 1px solid var(--border);
		cursor: pointer;
		pointer-events: auto;
	}

	.notice.error {
		border-color: var(--danger-border);
	}

	.notice a {
		color: var(--txt-1);
	}
</style>
