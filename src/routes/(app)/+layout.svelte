<script lang="ts">
	import { PUBLIC_CONVEX_URL } from '$app/env/public';
	import { setupConvex, useQuery } from 'convex-svelte';
	import {
		setItemsContext,
		setCollectionsContext,
		setCurrentItemsContext,
		setWriteTokenContext,
		type CurrentItems
	} from '#lib/context.js';
	import { isUnauthorized } from '#lib/convex.js';
	import { page } from '$app/state';
	import { afterNavigate, beforeNavigate, goto, snapshot } from '$app/navigation';
	import { loginHref } from '#lib/login.js';
	import { settleConfirmation } from '#lib/confirm.svelte.js';

	import Logo from '#lib/assets/logo.svelte';
	import ConfirmDialog from '#lib/components/ConfirmDialog.svelte';
	import ItemModal from '#lib/components/ItemModal.svelte';
	import Landing from '#lib/components/Landing.svelte';
	import Notices from '#lib/components/Notices.svelte';
	import Sidebar, { NAV_LINKS } from '#lib/components/Sidebar.svelte';
	import type { Id } from '../../convex/_generated/dataModel.js';
	import { api } from '../../convex/_generated/api.js';
	import IconMenu from '~icons/material-symbols-light/menu-sharp';
	import IconSearch from '~icons/material-symbols-light/search-sharp';

	let { children, data } = $props();
	setupConvex(PUBLIC_CONVEX_URL);

	// The signed-in user's items and collections (real-time). A logged-out
	// visitor, who can only be on a shared collection, has none.
	const items = useQuery(api.items.list, () =>
		data.writeToken ? { token: data.writeToken } : 'skip'
	);
	const collections = useQuery(api.collections.listWithCounts, () =>
		data.writeToken ? { token: data.writeToken } : 'skip'
	);

	// Logged out, home is the landing page and its waitlist
	const landing = $derived(!data.writeToken && page.route.id === '/(app)');

	const currentItems = $state<CurrentItems>({ list: () => [] });

	// Make available to all child routes via context
	setItemsContext(items);
	setCollectionsContext(collections);
	setCurrentItemsContext(currentItems);
	// Pass the token as a reactive getter so consumers always get the current value
	setWriteTokenContext(() => data.writeToken);

	// An ended session (signed out elsewhere, users:signOut) fails every query
	$effect(() => {
		if (isUnauthorized(collections.error)) goto(loginHref(page.url));
	});

	const editItemId = $derived(page.url.searchParams.get('item') as Id<'items'> | null);

	// Whether the history entry before this one is the same page without the modal,
	// so closing can step back to it instead of pushing a duplicate
	let modalHasBackEntry = false;
	let closing = false;

	function closeModal() {
		if (closing) return;
		closing = true;
		if (modalHasBackEntry) {
			history.back();
		} else {
			const url = new URL(page.url.href);
			url.searchParams.delete('item');
			goto(url, { replace: true, reset: false });
		}
	}

	// <main> is the scroll container, which SvelteKit's scroll handling (window only)
	// doesn't see. A Back/Forward restores the entry's position, applied as the content
	// grows because the page's queries may still be loading.
	let main: HTMLElement;
	let pendingScroll: number | null = null;

	function applyPendingScroll() {
		if (pendingScroll === null) return;
		main.scrollTop = pendingScroll;
		if (main.scrollHeight - main.clientHeight >= pendingScroll) pendingScroll = null;
	}

	function observeContent(node: HTMLElement) {
		const observer = new ResizeObserver(applyPendingScroll);
		observer.observe(node);
		return () => observer.disconnect();
	}

	snapshot({
		capture: () => ({ scroll: main.scrollTop, modalHasBackEntry }),
		restore: (value) => {
			modalHasBackEntry = value.modalHasBackEntry;
			pendingScroll = value.scroll;
			applyPendingScroll();
		}
	});

	// Runs before a Back/Forward's snapshot restore, which overrides it
	afterNavigate(({ from, to }) => {
		if (!to) return;
		closing = false;
		mobileMenuOpen = false;
		pendingScroll = null;

		const samePage = from?.url.pathname === to.url.pathname;
		if (!samePage) main.scrollTop = 0;

		const hasItem = to.url.searchParams.has('item');
		if (!hasItem) modalHasBackEntry = false;
		// Item to item (prev/next replaces the entry) keeps it
		else if (!from?.url.searchParams.has('item')) modalHasBackEntry = samePage;

		if (to.url.pathname === '/search' && !samePage && !hasItem) searchInputRef?.focus();
	});

	let searchInputRef = $state<HTMLInputElement>();
	let debounceTimer: ReturnType<typeof setTimeout> | undefined;

	// A pending search update would drag the user back to /search or close a just-opened item,
	// and a pending confirm would act on the page being left
	beforeNavigate(() => {
		clearTimeout(debounceTimer);
		settleConfirmation(false);
	});

	// Only the search page's query; a shared collection's ?q= is its own search
	const searchQuery = $derived(
		page.url.pathname === '/search' ? (page.url.searchParams.get('q') ?? '') : ''
	);

	function handleSearchFocus() {
		if (page.url.pathname !== '/search') {
			goto('/search', { reset: false });
		}
	}

	function handleSearchInput(e: Event) {
		const value = (e.target as HTMLInputElement).value;
		if (page.url.pathname === '/search') {
			clearTimeout(debounceTimer);
			debounceTimer = setTimeout(() => {
				const params = new URLSearchParams(page.url.search);
				if (value.trim()) {
					params.set('q', value);
				} else {
					params.delete('q');
				}
				params.delete('item');
				goto(`/search?${params}`, { replace: true, reset: false });
			}, 300);
		}
	}

	let mobileMenuOpen = $state(false);

	function toggleMobileMenu() {
		mobileMenuOpen = !mobileMenuOpen;
	}

	function closeMobileMenu() {
		mobileMenuOpen = false;
	}
</script>

{#snippet content()}
	<main
		bind:this={main}
		onwheel={() => (pendingScroll = null)}
		ontouchstart={() => (pendingScroll = null)}
	>
		<div {@attach observeContent}>
			{#if landing}
				<Landing />
			{:else}
				{@render children()}
			{/if}
		</div>
	</main>
{/snippet}

{#if landing}
	{@render content()}
{:else if !data.writeToken}
	<header>
		<nav>
			<div class="nav-links guest">
				<div class="logo"><Logo /></div>
				<span class="wordmark">re-collect</span>
			</div>
			<a href={loginHref(page.url)} class="nav-link">log in</a>
		</nav>
	</header>

	{@render content()}
{:else}
	<header>
		<nav>
			<button class="icon menu-btn" onclick={toggleMobileMenu} aria-label="toggle menu">
				<IconMenu />
			</button>
			<div class="nav-links">
				<div class="logo"><Logo /></div>
				{#each NAV_LINKS as { href, label } (href)}
					<a {href} class="nav-link" class:active={page.url.pathname === href}>{label}</a>
				{/each}
			</div>
			<div class="nav-search">
				<IconSearch />
				<input
					type="text"
					bind:this={searchInputRef}
					value={searchQuery}
					onfocus={handleSearchFocus}
					oninput={handleSearchInput}
					placeholder="search..."
				/>
			</div>
			<div class="nav-actions">
				<a href="/account" class="nav-link" class:active={page.url.pathname === '/account'}
					>account</a
				>
			</div>
		</nav>
	</header>

	{#if mobileMenuOpen}
		<button class="mobile-backdrop" onclick={closeMobileMenu} aria-label="close menu"></button>
	{/if}

	<div class="layout">
		<Sidebar bind:mobileOpen={mobileMenuOpen} />
		{@render content()}
	</div>
{/if}

{#if editItemId}
	<ItemModal itemId={editItemId} onClose={closeModal} />
{/if}

<ConfirmDialog />
<Notices />

<style>
	header {
		padding: var(--space-md) var(--gutter);
		border-bottom: 1px solid var(--border);
		flex-shrink: 0;
	}
	nav {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: var(--gutter);
	}
	.menu-btn {
		display: none;
	}
	.nav-links {
		display: flex;
		gap: var(--gap);
	}
	.logo {
		padding: 0 var(--pad-x);
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}
	.logo :global(svg) {
		width: 1.5rem;
		height: 1.5rem;
	}
	.nav-search {
		display: flex;
		align-items: center;
		gap: var(--gap);
		padding: var(--pad-y) var(--pad-x);
		border: 1px solid var(--border);
		background: var(--bg-2);
	}
	.nav-search:focus-within {
		border-color: var(--txt-3);
	}
	.nav-search input {
		width: 33vw;
		border: none;
		padding: 0;
		background: transparent;
	}
	.nav-search :global(svg) {
		width: 1.5rem;
		height: 1.5rem;
	}
	.nav-search input:focus {
		outline: none;
	}
	.nav-actions {
		display: flex;
		align-items: center;
	}
	.mobile-backdrop {
		display: none;
	}
	.layout {
		display: flex;
		flex: 1;
		min-height: 0;
	}
	main {
		/* a full-bleed page (the atlas map) positions itself against it */
		position: relative;
		flex: 1;
		padding: var(--gutter);
		overflow-y: auto;
	}
	.wordmark {
		display: flex;
		align-items: center;
		padding: var(--pad-y) var(--pad-x);
	}

	@media (max-width: 768px) {
		.nav-links.guest {
			display: flex;
		}
		header {
			padding: var(--space-md) var(--gutter) var(--space-md) var(--space-md);
		}
		nav {
			gap: var(--gap);
		}
		.menu-btn {
			display: flex;
			padding: var(--pad-y-sm);
		}
		.nav-links {
			display: none;
		}
		.nav-search {
			flex: 1;
			padding: var(--pad-y-sm) var(--space-xs) var(--pad-y-sm) var(--pad-x);
			gap: var(--gap);
		}
		.nav-search :global(svg) {
			width: 1.375rem;
			height: 1.375rem;
		}
		.nav-search input {
			width: 100%;
			min-width: 0;
		}
		.nav-actions {
			display: none;
		}
		.mobile-backdrop {
			display: block;
			position: fixed;
			top: 0;
			left: 0;
			right: 0;
			bottom: 0;
			background: oklch(from var(--bg-1) l c h / 0.5);
			backdrop-filter: blur(5px);
			z-index: 99;
			border: none;
			padding: 0;
			cursor: default;
		}
	}
</style>
