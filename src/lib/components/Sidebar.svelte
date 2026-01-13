<script lang="ts">
	import { getContext } from 'svelte';
	import { page } from '$app/state';

	const collections =
		getContext<ReturnType<typeof import('convex-svelte').useQuery>>('collections');

	let collapsed = $state(false);
</script>

<aside class:collapsed>
	{#if !collapsed}
		<nav class="collections">
			{#if collections.isLoading}
				<p class="status-text">loading...</p>
			{:else if collections.error}
				<p class="status-text">error loading</p>
			{:else if collections.data?.length === 0}
				<p class="status-text">no collections</p>
			{:else}
				<ul>
					{#each collections.data ?? [] as collection (collection._id)}
						{@const isActive = page.url.pathname === `/collections/${collection._id}`}
						<li>
							<a href="/collections/{collection._id}" class:active={isActive}>
								<span class="name">{collection.name}</span>
								<span class="count">{collection.itemCount}</span>
							</a>
						</li>
					{/each}
				</ul>
			{/if}
		</nav>
	{/if}
	<button
		class="icon toggle"
		onclick={() => (collapsed = !collapsed)}
		aria-label={collapsed ? 'expand sidebar' : 'collapse sidebar'}
	>
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
			{#if collapsed}
				<path d="M9 18l6-6-6-6" />
			{:else}
				<path d="M15 18l-6-6 6-6" />
			{/if}
		</svg>
	</button>
</aside>

<style>
	aside {
		position: relative;
		width: 15rem;
		min-width: 15rem;
		border-right: 1px solid var(--border);
		padding: 1rem;
		display: flex;
		flex-direction: column;
		transition:
			width 0.2s ease,
			min-width 0.2s ease;
	}

	aside.collapsed {
		width: 3rem;
		min-width: 3rem;
		padding: 1rem 0.5rem;
	}

	/* Uses global button.icon styles from app.css */
	.toggle {
		position: absolute;
		bottom: 0.5rem;
		right: 0.5rem;
		width: 2rem;
		height: 2rem;
	}

	.collapsed .toggle {
		margin: 0 auto;
	}

	.toggle svg {
		width: 1.25rem;
		height: 1.25rem;
	}

	ul {
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	li a {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.5rem;
		text-decoration: none;
	}

	li a:hover {
		background: var(--bg-2);
	}

	li a.active {
		background: var(--bg-3);
	}

	.name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.count {
		font-size: 0.875rem;
		color: var(--txt-3);
		flex-shrink: 0;
		margin-left: 0.5rem;
	}
</style>
