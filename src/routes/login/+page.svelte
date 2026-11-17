<script lang="ts">
	import { enhance } from '$app/forms';

	let { data } = $props();

	const signup = $derived(!!data.invite);
	let username = $state('');
	let password = $state('');
	let error = $state('');
	let isSubmitting = $state(false);

	const idleLabel = $derived(signup ? 'create account' : 'login');
	const busyLabel = $derived(signup ? 'creating account...' : 'logging in...');
</script>

<div class="login-container">
	<div class="login-box">
		<h1>re-collect</h1>

		<form
			class="form"
			method="POST"
			action={signup ? '?/signup' : '?/login'}
			use:enhance={() => {
				isSubmitting = true;
				error = '';
				return async ({ result, update }) => {
					isSubmitting = false;
					if (result.type === 'failure') {
						error = String(result.data?.message || 'something went wrong');
						password = '';
					}
					await update({ reset: false });
				};
			}}
		>
			{#if data.invite}
				<input type="hidden" name="invite" value={data.invite} />
			{/if}
			<input type="hidden" name="next" value={data.next} />
			<input
				name="username"
				bind:value={username}
				placeholder="Username"
				disabled={isSubmitting}
				autocomplete="username"
				autocapitalize="none"
				required
			/>
			<input
				type="password"
				name="password"
				bind:value={password}
				placeholder="Password"
				disabled={isSubmitting}
				autocomplete={signup ? 'new-password' : 'current-password'}
				minlength={signup ? 8 : undefined}
				required
			/>
			<button type="submit" disabled={isSubmitting} class:error={!!error}>
				{error || (isSubmitting ? busyLabel : idleLabel)}
			</button>
		</form>
	</div>
</div>

<style>
	.login-container {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 100dvh;
		padding: var(--gutter);
		background: var(--bg-1);
	}

	.login-box {
		background: var(--bg-1);
		border: 1px solid var(--border);
		padding: var(--gutter);
		width: 100%;
		max-width: 24rem;
	}

	h1 {
		font-size: var(--text-xl);
		margin-bottom: var(--space-md);
	}
</style>
