<script lang="ts">
	import { useConvexClient } from 'convex-svelte';
	import { ConvexError } from 'convex/values';
	import { api } from '../../convex/_generated/api.js';
	import Logo from '#lib/assets/logo.svelte';
	import IconCheck from '~icons/material-symbols-light/check-sharp';
	import IconProgress from '~icons/material-symbols-light/progress-activity-sharp';

	const client = useConvexClient();

	let email = $state('');
	let website = $state('');
	let status = $state<'idle' | 'submitting' | 'joined'>('idle');
	let error = $state('');

	async function join(event: SubmitEvent) {
		event.preventDefault();
		status = 'submitting';
		error = '';
		try {
			await client.mutation(api.waitlist.join, { email, website });
			status = 'joined';
		} catch (e) {
			status = 'idle';
			error =
				e instanceof ConvexError && typeof e.data === 'string'
					? e.data
					: 'something went wrong, try again';
		}
	}
</script>

<div class="landing">
	<a href="/login" class="login">log in</a>

	<div class="content">
		<div class="name">
			<Logo />
			<h1>re-collect</h1>
		</div>

		<p>
			A place to collect links (with a screenshot), images and notes, sort them into collections,
			and find them again later.
		</p>
		<p class="muted">
			Invite-only for now. Leave your email and I'll send you an invite when it's ready.
		</p>

		<form onsubmit={join}>
			<div class="row">
				<input
					type="email"
					name="email"
					bind:value={email}
					placeholder="you@example.com"
					autocomplete="email"
					aria-label="email"
					disabled={status !== 'idle'}
					required
				/>
				<button type="submit" disabled={status !== 'idle'} class:joined={status === 'joined'}>
					{#if status === 'submitting'}
						<IconProgress class="spin" />joining
					{:else if status === 'joined'}
						<IconCheck />you're on the list
					{:else}
						join the waitlist
					{/if}
				</button>
			</div>
			<!-- Honeypot: hidden from people, filled by some bots -->
			<input
				class="honeypot"
				name="website"
				bind:value={website}
				tabindex="-1"
				autocomplete="off"
				aria-hidden="true"
			/>
			<p class="error" aria-live="polite">{error}</p>
		</form>
	</div>
</div>

<style>
	/* Fills the layout's <main> (the whole screen here), which pads and scrolls it */
	.landing {
		position: relative;
		min-height: calc(100dvh - 2 * var(--gutter));
		/* clear of the log in link, on a screen too short to center in */
		padding-block: calc(1.5rem + 2 * var(--pad-y));
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.login {
		position: absolute;
		top: 0;
		right: 0;
		padding: var(--pad-y) var(--pad-x);
		color: var(--txt-3);
		text-decoration: none;
	}
	.login:hover {
		color: var(--txt-1);
	}

	.content {
		width: 100%;
		max-width: 30rem;
		display: flex;
		flex-direction: column;
		gap: var(--space-xl);
	}

	.name {
		display: flex;
		align-items: center;
		gap: var(--space-md);
		margin-bottom: var(--space-md);
		color: var(--txt-1);
	}
	.name :global(svg) {
		width: 2.25rem;
		height: 2.25rem;
	}

	.muted {
		color: var(--txt-3);
	}

	form {
		display: flex;
		flex-direction: column;
		gap: var(--gap);
		margin-top: var(--space-md);
	}

	.row {
		display: flex;
		gap: var(--gap);
	}
	.row input {
		flex: 1;
		min-width: 0;
	}
	.row button {
		flex-shrink: 0;
	}

	.honeypot {
		position: absolute;
		left: -10000px;
		width: 1px;
		height: 1px;
		opacity: 0;
	}

	.error {
		font-size: var(--text-sm);
		color: var(--danger-border);
	}
	.error:empty {
		display: none;
	}

	.row button :global(svg) {
		width: 1.25rem;
		height: 1.25rem;
	}
	.row button :global(.spin) {
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(1turn);
		}
	}
	/* Done, not unavailable: keep it readable */
	.row button.joined:disabled {
		color: var(--txt-1);
		cursor: default;
	}

	@media (max-width: 480px) {
		.row {
			flex-direction: column;
		}
	}
</style>
