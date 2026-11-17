<script lang="ts">
	import { tick } from 'svelte';
	import { api } from '../../../convex/_generated/api.js';
	import { useAction, useMutation, useQuery } from '#lib/convex.js';
	import { usePageTitle } from '#lib/pageTitle.svelte.js';

	usePageTitle(() => 'account');

	const mutate = useMutation();
	const act = useAction();

	const me = useQuery(api.users.me, () => ({}));

	// The browser extension gets its own session, so it never needs the password;
	// a new token replaces the previous one. Only its hash is stored, so it can be
	// shown just this once, and lives only in this page's state.
	let extensionToken = $state<string | null>(null);
	let tokenField = $state<HTMLInputElement>();
	let tokenCopied = $state(false);
	let creatingToken = $state(false);

	async function createExtensionToken() {
		creatingToken = true;
		const token = await act(api.sessions.createExtensionToken, {});
		creatingToken = false;
		if (token === undefined) return;
		extensionToken = token;
		tokenCopied = false;
		await tick();
		copyExtensionToken();
	}

	async function copyExtensionToken() {
		if (!extensionToken) return;
		try {
			await navigator.clipboard.writeText(extensionToken);
			tokenCopied = true;
			setTimeout(() => (tokenCopied = false), 2000);
		} catch {
			// Clipboard blocked: select it for copying by hand
			tokenField?.focus();
			tokenField?.select();
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
		passwordStatus = '';
		passwordError = false;
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
			paste a token into the extension's settings. it survives password changes, and making a new
			one revokes the old one.
		</p>
		<button onclick={createExtensionToken} disabled={creatingToken}
			>{extensionToken ? 'new token' : 'create token'}</button
		>
		{#if extensionToken}
			<div class="token">
				<input
					bind:this={tokenField}
					value={extensionToken}
					readonly
					aria-label="extension token"
					aria-describedby="token-note"
					autocomplete="off"
					spellcheck="false"
					onfocus={(e) => e.currentTarget.select()}
				/>
				<button onclick={copyExtensionToken}>{tokenCopied ? 'copied' : 'copy'}</button>
			</div>
			<p class="meta" id="token-note">it won't be shown again once you leave this page.</p>
		{/if}
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

	section .form,
	.token {
		width: 100%;
		max-width: 24rem;
	}

	.token {
		display: flex;
		gap: var(--gap);
	}

	.token input {
		flex: 1;
		min-width: 0;
	}
</style>
