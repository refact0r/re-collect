<script lang="ts">
	import { api } from '../../../convex/_generated/api.js';
	import { useAction, useMutation, useQuery } from '#lib/convex.js';

	const mutate = useMutation();
	const act = useAction();

	const me = useQuery(api.users.me, () => ({}));

	let tokenCopied = $state(false);

	// The browser extension gets its own session, so it never needs the password;
	// a new token replaces the previous one
	async function copyExtensionToken() {
		const token = await act(api.sessions.createExtensionToken, {});
		if (token === undefined) return;
		try {
			await navigator.clipboard.writeText(token);
			tokenCopied = true;
			setTimeout(() => (tokenCopied = false), 2000);
		} catch {
			// Clipboard blocked: show it for manual copying instead
			prompt('Copy your extension token:', token);
		}
	}

	let signedOutOthers = $state(false);

	async function signOutOthers() {
		if ((await mutate(api.sessions.signOutOthers, {})) !== undefined) signedOutOthers = true;
	}

	let currentPassword = $state('');
	let newPassword = $state('');
	let passwordStatus = $state('');
	let passwordError = $state(false);
	let changingPassword = $state(false);

	async function changePassword(event: SubmitEvent) {
		event.preventDefault();
		changingPassword = true;
		// The form shows its own errors
		const changed = await act(
			api.sessions.changePassword,
			{ currentPassword, newPassword },
			{ onError: (message) => (passwordStatus = message) }
		);
		changingPassword = false;
		passwordError = changed === undefined;
		if (!passwordError) {
			passwordStatus = 'password changed';
			currentPassword = '';
			newPassword = '';
		}
	}
</script>

<div class="page-column">
	<div class="page-header">
		<h1>account</h1>
		{#if me.data}
			<p class="meta">signed in as {me.data.username}</p>
		{/if}
	</div>

	<section>
		<h2>browser extension</h2>
		<p class="meta">
			paste this token into the extension's settings. it survives password changes, and copying a
			new one revokes the old one.
		</p>
		<button onclick={copyExtensionToken}>{tokenCopied ? 'copied' : 'copy token'}</button>
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
		<h2>sessions</h2>
		<p class="meta">
			signs out every other browser and the extension, which will need a new token.
		</p>
		<button onclick={signOutOthers} disabled={signedOutOthers}>
			{signedOutOthers ? 'signed out' : 'sign out everywhere else'}
		</button>
		<form method="POST" action="/logout">
			<button>log out</button>
		</form>
	</section>
</div>

<style>
	section {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-lg);
	}

	section .form {
		width: 100%;
		max-width: 24rem;
	}
</style>
