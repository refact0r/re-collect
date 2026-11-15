<script lang="ts">
	import { confirmation, settleConfirmation } from '#lib/confirm.svelte.js';
	import Modal from './Modal.svelte';
</script>

{#if confirmation.request}
	{@const { title, message, action, danger } = confirmation.request}
	<Modal onClose={() => settleConfirmation(false)} size="narrow" labelledby="confirm-title">
		<h2 id="confirm-title">{title}</h2>
		{#if message}
			<p class="meta">{message}</p>
		{/if}
		<div class="actions">
			<button onclick={() => settleConfirmation(false)}>cancel</button>
			<!-- svelte-ignore a11y_autofocus -->
			<button class={{ danger }} onclick={() => settleConfirmation(true)} autofocus>
				{action}
			</button>
		</div>
	</Modal>
{/if}

<style>
	h2 {
		margin: 0;
	}

	p {
		margin: var(--space-lg) 0 0 0;
	}

	.actions {
		display: flex;
		gap: var(--gap);
		margin-top: var(--space-xl);
	}

	.actions button {
		flex: 1;
	}
</style>
