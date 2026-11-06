<script lang="ts">
	import { enhance } from '$app/forms';

	let { data } = $props();

	let code = $state('');
	// Writable derived: starts from the login-link result, then tracks form errors
	let error = $derived(data.invalidLink ? 'invalid link' : '');
	let isSubmitting = $state(false);
</script>

<div class="login-container">
	<div class="login-box">
		<h1>re-collect</h1>

		<form
			class="form"
			method="POST"
			use:enhance={() => {
				isSubmitting = true;
				error = '';
				return async ({ result, update }) => {
					isSubmitting = false;
					if (result.type === 'failure') {
						error = String(result.data?.message || 'invalid code');
						code = '';
					}
					await update();
				};
			}}
		>
			<input
				type="password"
				name="code"
				bind:value={code}
				placeholder="Access code"
				disabled={isSubmitting}
				autocomplete="current-password"
				required
			/>
			<button type="submit" disabled={isSubmitting} class:error={!!error}>
				{error || (isSubmitting ? 'logging in...' : 'login')}
			</button>
		</form>
	</div>
</div>

<style>
	.login-container {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		padding: var(--spacing);
		background: var(--bg-1);
	}

	.login-box {
		background: var(--bg-1);
		border: 1px solid var(--border);
		padding: var(--spacing);
		width: 100%;
		max-width: 24rem;
	}

	h1 {
		font-size: 1.5rem;
		margin-bottom: 0.5rem;
	}

	button.error {
		color: var(--danger-border);
	}
</style>
