<script lang="ts">
	import { getContext } from 'svelte';
	import { page } from '$app/state';
	import IconClose from '~icons/material-symbols-light/close';
	import IconChevronLeft from '~icons/material-symbols-light/chevron-left';
	import IconChevronRight from '~icons/material-symbols-light/chevron-right';

	const collections =
		getContext<ReturnType<typeof import('convex-svelte').useQuery>>('collections');
	const isAuthenticated = getContext<boolean>('isAuthenticated');

	let collapsed = $state(false);
	let { mobileOpen = $bindable(false) } = $props();
</script>

<aside class:collapsed class:mobile-open={mobileOpen}>
	<div class="mobile-header">
		<div class="logo"><span>※</span></div>
		<button class="icon close-mobile" onclick={() => (mobileOpen = false)} aria-label="close menu">
			<IconClose />
		</button>
	</div>
	<nav class="main-nav">
		<a
			href="/"
			class="nav-link"
			class:active={page.url.pathname === '/'}
			onclick={() => (mobileOpen = false)}>re-collect</a
		>
		<a
			href="/collections"
			class="nav-link"
			class:active={page.url.pathname === '/collections'}
			onclick={() => (mobileOpen = false)}>collections</a
		>
		{#if isAuthenticated}
			<a href="/logout" class="nav-link" onclick={() => (mobileOpen = false)}>logout</a>
		{:else}
			<a href="/login" class="nav-link" onclick={() => (mobileOpen = false)}>login</a>
		{/if}
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
								class="nav-link collapsed-link"
								class:active={isActive}
								title={collection.name}
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
						<a href="/collections/{collection._id}" class="nav-link" class:active={isActive}>
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
		padding: var(--spacing);
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
		padding: var(--spacing) 0.5rem;
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
			transition: transform 0.2s ease;
			background: var(--bg-1);
			border-right: 1px solid var(--border);
			padding: 0;
			overflow-y: auto;
		}

		.close-mobile {
			padding: 0.25rem;
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
			justify-content: space-between;
			align-items: center;
			padding: 0.5rem;
			border-bottom: 1px solid var(--border);
			flex-shrink: 0;
		}

		.logo {
			padding: 0 0.5rem;
			display: inline-flex;
			align-items: center;
			justify-content: center;
		}

		.logo span {
			font-size: 1.5rem;
			font-weight: 300;
			font-family: DM Mono;
			line-height: 1.5rem;
			margin-top: 0.125rem;
		}

		.main-nav {
			display: flex;
			flex-direction: column;
			padding: var(--spacing);
			gap: 0.25rem;
			border-bottom: 1px solid var(--border);
			flex-shrink: 0;
		}

		.collections {
			padding: var(--spacing);
			flex: 1;
			overflow-y: auto;
		}

		.toggle {
			display: none;
		}
	}

	.toggle {
		position: absolute;
		bottom: 0.5rem;
		right: 0.5rem;
		padding: 0.25rem;
		width: 2rem;
	}

	.toggle :global(svg) {
		width: 1.25rem;
		height: 1.25rem;
	}

	.collapsed .toggle {
		margin: 0 auto;
	}

	ul {
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	li a {
		justify-content: space-between;
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
