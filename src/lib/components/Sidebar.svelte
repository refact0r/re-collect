<script lang="ts">
	import { getContext } from 'svelte';
	import { page } from '$app/state';
	import IconClose from '~icons/material-symbols/close-sharp';
	import IconChevronLeft from '~icons/material-symbols/chevron-left-sharp';
	import IconChevronRight from '~icons/material-symbols/chevron-right-sharp';

	const collections =
		getContext<ReturnType<typeof import('convex-svelte').useQuery>>('collections');

	let collapsed = $state(false);
	let { mobileOpen = $bindable(false) } = $props();
</script>

<aside class:collapsed class:mobile-open={mobileOpen}>
	<div class="mobile-header">
		<button
			class="icon close-mobile"
			onclick={() => (mobileOpen = false)}
			aria-label="close menu"
		>
			<IconClose />
		</button>
	</div>
	<nav class="main-nav">
		<a href="/" class:active={page.url.pathname === '/'} onclick={() => (mobileOpen = false)}
			>re-collect</a
		>
		<a
			href="/collections"
			class:active={page.url.pathname === '/collections'}
			onclick={() => (mobileOpen = false)}>collections</a
		>
		<a href="/logout" onclick={() => (mobileOpen = false)}>logout</a>
	</nav>
	<nav class="collections">
		{#if collapsed}
			{#if collections.isLoading}
				<div class="collapsed-indicator">...</div>
			{:else if collections.error}
				<div class="collapsed-indicator">!</div>
			{:else}
				<ul>
					{#each collections.data ?? [] as collection (collection._id)}
						{@const isActive = page.url.pathname === `/collections/${collection._id}`}
						<li>
							<a
								href="/collections/{collection._id}"
								class:active={isActive}
								title={collection.name}
								class="collapsed-link"
							>
								{collection.name.charAt(0)}
							</a>
						</li>
					{/each}
				</ul>
			{/if}
		{:else if collections.isLoading}
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
	<button
		class="icon toggle"
		onclick={() => (collapsed = !collapsed)}
		aria-label={collapsed ? 'expand sidebar' : 'collapse sidebar'}
	>
		{#if collapsed}
			<IconChevronRight />
		{:else}
			<IconChevronLeft />
		{/if}
	</button>
</aside>

<style>
	aside {
		position: relative;
		width: 15rem;
		min-width: 15rem;
		border-right: 1px solid var(--border);
		padding: 1rem;
		padding-bottom: 3.5rem;
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
		padding-bottom: 3.5rem;
	}

	.mobile-header {
		display: none;
	}

	.main-nav {
		display: none;
	}

	@media (max-width: 768px) {
		aside {
			position: fixed;
			top: 0;
			left: 0;
			bottom: 0;
			z-index: 100;
			transform: translateX(-100%);
			transition: transform 0.3s ease;
			background: var(--bg-1);
			border-right: 1px solid var(--border);
			padding: 0;
			overflow-y: auto;
		}

		aside.mobile-open {
			transform: translateX(0);
		}

		aside.collapsed {
			width: 15rem;
			min-width: 15rem;
			padding: 0;
		}

		.mobile-header {
			display: flex;
			justify-content: flex-end;
			padding: 0.5rem 0.5rem 0.5rem 1rem;
			border-bottom: 1px solid var(--border);
			flex-shrink: 0;
		}

		.close-mobile :global(svg) {
			width: 1.5rem;
			height: 1.5rem;
		}

		.main-nav {
			display: flex;
			flex-direction: column;
			padding: 1rem;
			gap: 0.25rem;
			border-bottom: 1px solid var(--border);
			flex-shrink: 0;
		}

		.main-nav a {
			padding: 0.5rem;
			text-decoration: none;
		}

		.main-nav a:hover {
			background: var(--bg-2);
			color: var(--txt-1);
		}

		.main-nav a.active {
			background: var(--bg-2);
			color: var(--txt-1);
		}

		.collections {
			padding: 1rem;
			flex: 1;
			overflow-y: auto;
		}

		.toggle {
			display: none;
		}
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

	.toggle :global(svg) {
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
		border: 1px solid transparent;
	}

	li a:hover {
		background: var(--bg-2);
		color: var(--txt-1);
	}

	li a.active {
		background: var(--bg-2);
		border: 1px solid var(--border);
		color: var(--txt-1);
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

	.collapsed-link {
		width: 2rem;
		padding: 0.5rem;
		font-weight: 500;
		justify-content: center;
	}

	.collapsed-indicator {
		text-align: center;
		font-size: 0.875rem;
		color: var(--txt-3);
		padding: 0.5rem;
	}

	.collapsed ul {
		align-items: center;
	}

	.collapsed li {
		display: flex;
		justify-content: center;
	}
</style>
