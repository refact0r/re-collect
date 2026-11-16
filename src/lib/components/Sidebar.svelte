<script lang="ts" module>
	// The app's pages, in the header on desktop and in this sidebar on mobile
	export const NAV_LINKS = [
		{ href: '/', label: 're-collect' },
		{ href: '/collections', label: 'collections' },
		{ href: '/atlas', label: 'atlas' },
		{ href: '/patterns', label: 'patterns' },
		{ href: '/discover', label: 'discover' }
	];
</script>

<script lang="ts">
	import { page } from '$app/state';
	import IconClose from '~icons/material-symbols-light/close-sharp';
	import IconChevronLeft from '~icons/material-symbols-light/chevron-left-sharp';
	import IconChevronRight from '~icons/material-symbols-light/chevron-right-sharp';
	import Logo from '#lib/assets/logo.svelte';
	import { getCollectionsContext } from '#lib/context.js';

	const collections = getCollectionsContext();

	let collapsed = $state(false);
	let { mobileOpen = $bindable(false) } = $props();
</script>

<aside class:collapsed class:mobile-open={mobileOpen}>
	<div class="mobile-header">
		<div class="logo"><Logo /></div>
		<button class="icon close-mobile" onclick={() => (mobileOpen = false)} aria-label="close menu">
			<IconClose />
		</button>
	</div>
	<nav class="main-nav">
		{#each NAV_LINKS as { href, label } (href)}
			<a {href} class="nav-link" class:active={page.url.pathname === href}>{label}</a>
		{/each}
		<a href="/account" class="nav-link" class:active={page.url.pathname === '/account'}>account</a>
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
		--toggle-size: 2rem;
		--toggle-inset: var(--space-md);
		/* stays put while the page beside it scrolls */
		position: sticky;
		top: 0;
		height: 100%;
		overflow-y: auto;
		width: 15rem;
		min-width: 15rem;
		border-right: 1px solid var(--border);
		padding: var(--gutter);
		/* clears the collapse toggle pinned in the corner */
		padding-bottom: calc(var(--toggle-inset) + var(--toggle-size) + var(--gutter));
		display: flex;
		flex-direction: column;
		transition:
			width 0.2s ease,
			min-width 0.2s ease;
	}

	aside.collapsed {
		width: 3rem;
		min-width: 3rem;
		padding-inline: var(--space-md);
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
			padding: var(--pad-y-sm);
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
			padding: var(--space-md);
			border-bottom: 1px solid var(--border);
			flex-shrink: 0;
		}

		.logo {
			padding: 0 var(--space-md);
			display: inline-flex;
			align-items: center;
			justify-content: center;
		}

		.logo :global(svg) {
			width: 1.5rem;
			height: 1.5rem;
		}

		.main-nav {
			display: flex;
			flex-direction: column;
			padding: var(--gutter);
			gap: var(--gap-sm);
			border-bottom: 1px solid var(--border);
			flex-shrink: 0;
		}

		.collections {
			padding: var(--gutter);
			flex: 1;
			overflow-y: auto;
		}

		.toggle {
			display: none;
		}
	}

	.toggle {
		position: absolute;
		bottom: var(--toggle-inset);
		right: var(--toggle-inset);
		padding: var(--pad-y-sm);
		width: var(--toggle-size);
	}

	.toggle :global(svg) {
		width: 1.25rem;
		height: 1.25rem;
	}

	ul {
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: var(--gap-sm);
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
		font-size: var(--text-sm);
		color: var(--txt-3);
		flex-shrink: 0;
		margin-left: var(--space-md);
	}

	.collapsed-link {
		width: 2rem;
		font-weight: 500;
		justify-content: center;
	}

	.collapsed-indicator {
		text-align: center;
		font-size: var(--text-sm);
		color: var(--txt-3);
		padding: var(--space-md);
	}

	.collapsed ul {
		align-items: center;
	}

	.collapsed li {
		display: flex;
		justify-content: center;
	}
</style>
