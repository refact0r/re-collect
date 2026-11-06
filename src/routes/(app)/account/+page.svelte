<script lang="ts">
	import { useConvexClient, useQuery } from 'convex-svelte';
	import { ConvexError } from 'convex/values';
	import { api } from '../../../convex/_generated/api.js';
	import { getWriteTokenContext } from '#lib/context.js';

	const client = useConvexClient();
	const getWriteToken = getWriteTokenContext();
	const writeToken = $derived(getWriteToken());

	const me = useQuery(api.users.me, () => ({ token: writeToken }));

	let tokenCopied = $state(false);

	// The browser extension gets its own session, so it never needs the password
	async function copyExtensionToken() {
		const token = await client.action(api.sessions.createExtensionToken, { token: writeToken });
		try {
			await navigator.clipboard.writeText(token);
			tokenCopied = true;
			setTimeout(() => (tokenCopied = false), 2000);
		} catch {
			// Clipboard blocked: show it for manual copying instead
			prompt('Copy your extension token:', token);
		}
	}

	let currentPassword = $state('');
	let newPassword = $state('');
	let passwordStatus = $state('');
	let passwordError = $state(false);
	let changingPassword = $state(false);

	async function changePassword(event: SubmitEvent) {
		event.preventDefault();
		changingPassword = true;
		try {
			await client.action(api.sessions.changePassword, {
				token: writeToken,
				currentPassword,
				newPassword
			});
			passwordStatus = 'password changed';
			passwordError = false;
			currentPassword = '';
			newPassword = '';
		} catch (error) {
			passwordStatus = error instanceof ConvexError ? String(error.data) : 'something went wrong';
			passwordError = true;
		} finally {
			changingPassword = false;
		}
	}
</script>

<div class="container">
	<div class="page-header">
		<h1>account</h1>
		{#if me.data}
			<p class="meta">signed in as {me.data.username}</p>
		{/if}
	</div>

	<section>
		<h2>browser extension</h2>
		<p class="meta">
			copy a token and paste it into the extension's settings. each token is its own session, so it
			keeps working when you change your password.
		</p>
		<button onclick={copyExtensionToken}>{tokenCopied ? 'copied' : 'copy extension token'}</button>
	</section>

	<section>
		<h2>password</h2>
		<form class="form" onsubmit={changePassword}>
			<input
				type="password"
				bind:value={currentPassword}
				placeholder="Current password"
				autocomplete="current-password"
				disabled={changingPassword}
				required
			/>
			<input
				type="password"
				bind:value={newPassword}
				placeholder="New password"
				autocomplete="new-password"
				minlength="8"
				disabled={changingPassword}
				required
			/>
			<button type="submit" disabled={changingPassword} class:error={passwordError}>
				{passwordStatus || (changingPassword ? 'changing...' : 'change password')}
			</button>
		</form>
	</section>

	<section>
		<form method="POST" action="/logout">
			<button>log out</button>
		</form>
	</section>
</div>

<style>
	.container {
		display: flex;
		flex-direction: column;
		gap: 2rem;
		max-width: 24rem;
	}

	.page-header {
		margin-bottom: 0;
	}

	section {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.75rem;
	}

	section .form {
		align-self: stretch;
	}

	button.error {
		color: var(--danger-border);
	}
</style>
