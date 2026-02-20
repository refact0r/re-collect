<script lang="ts">
	import { PUBLIC_CONVEX_URL } from '$env/static/public';
	import { setupConvex, useQuery } from 'convex-svelte';
	import { setContext, onDestroy } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import favicon from '$lib/assets/favicon.svg';
	import ItemModal from '$lib/components/ItemModal.svelte';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import type { Id } from '../../convex/_generated/dataModel.js';
	import { api } from '../../convex/_generated/api.js';
	import IconMenu from '~icons/material-symbols-light/menu';
	import IconSearch from '~icons/material-symbols-light/search';

	let { children, data } = $props();
	setupConvex(PUBLIC_CONVEX_URL);

	// Auth state from server
	const { isAuthenticated, writeToken } = data;

	// Fetch all items and collections on load (with real-time sync)
	const items = useQuery(api.items.list, {});
	const collections = useQuery(api.collections.listWithCounts, {});

	// State for current items being displayed (set by active page)
	let currentItems = $state<any[]>([]);

	// Make available to all child routes via context
	setContext('items', items);
	setContext('collections', collections);
	setContext('currentItems', {
		get items() {
			return currentItems;
		},
		setItems(newItems: any[]) {
			currentItems = newItems;
		}
	});
	setContext('writeToken', writeToken);
	setContext('isAuthenticated', isAuthenticated);

	const editItemId = $derived(page.url.searchParams.get('item') as Id<'items'> | null);

	function closeModal() {
		const url = new URL(page.url);
		url.searchParams.delete('item');
		goto(url.pathname + url.search, { replaceState: false });
	}

	let searchInputRef: HTMLInputElement;
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;

	onDestroy(() => {
		if (debounceTimer) clearTimeout(debounceTimer);
	});

	const searchQuery = $derived(page.url.searchParams.get('q') ?? '');

	function handleSearchFocus() {
		if (page.url.pathname !== '/search') {
			goto('/search', { keepFocus: true });
		}
	}

	function handleSearchInput(e: Event) {
		const value = (e.target as HTMLInputElement).value;
		if (page.url.pathname === '/search') {
			if (debounceTimer) clearTimeout(debounceTimer);
			debounceTimer = setTimeout(() => {
				const params = new URLSearchParams(page.url.searchParams);
				if (value.trim()) {
					params.set('q', value);
				} else {
					params.delete('q');
				}
				params.delete('item');
				goto(`/search?${params}`, { replaceState: true, keepFocus: true });
			}, 300);
		}
	}

	$effect(() => {
		if (page.url.pathname === '/search' && searchInputRef) {
			searchInputRef.focus();
		}
	});

	let mobileMenuOpen = $state(false);

	function toggleMobileMenu() {
		mobileMenuOpen = !mobileMenuOpen;
	}

	function closeMobileMenu() {
		mobileMenuOpen = false;
	}
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{#if !isAuthenticated}
	<div class="read-only-banner">not logged in. read-only mode</div>
{/if}

<header>
	<nav>
		<button class="icon menu-btn" onclick={toggleMobileMenu} aria-label="toggle menu">
			<IconMenu />
		</button>
		<div class="nav-links">
			<div class="logo"><span>※</span></div>
			<a href="/" class="nav-link" class:active={page.url.pathname === '/'}>re-collect</a>
			<a href="/collections" class="nav-link" class:active={page.url.pathname === '/collections'}
				>collections</a
			>
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
			{#if isAuthenticated}
				<a href="/logout" class="nav-link">logout</a>
			{:else}
				<a href="/login" class="nav-link">login</a>
			{/if}
		</div>
	</nav>
</header>

{#if mobileMenuOpen}
	<button class="mobile-backdrop" onclick={closeMobileMenu} aria-label="close menu"></button>
{/if}

<div class="layout">
	<Sidebar bind:mobileOpen={mobileMenuOpen} />
	<main>
		{@render children()}
	</main>
</div>

{#if editItemId}
	<ItemModal itemId={editItemId} onClose={closeModal} />
{/if}

<style>
	header {
		padding: 0.5rem var(--spacing) 0.5rem var(--spacing);
		border-bottom: 1px solid var(--border);
		flex-shrink: 0;
	}
	nav {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: var(--spacing);
	}
	.menu-btn {
		display: none;
	}
	.nav-links {
		display: flex;
		gap: 0.5rem;
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
	.nav-search {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem;
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
	.read-only-banner {
		padding: 0.5rem var(--spacing);
		background: var(--danger-bg);
		border-bottom: 1px solid var(--danger-border);
		text-align: center;
		font-size: 0.875rem;
		color: var(--txt-1);
	}
	.layout {
		display: flex;
		flex: 1;
		min-height: 0;
	}
	.layout :global(aside) {
		position: sticky;
		top: 0;
		height: 100%;
		overflow-y: auto;
	}
	main {
		flex: 1;
		padding: var(--spacing);
		overflow-y: auto;
	}

	@media (max-width: 768px) {
		header {
			padding: 0.5rem var(--spacing) 0.5rem 0.5rem;
		}
		nav {
			gap: 0.5rem;
		}
		.menu-btn {
			display: flex;
			padding: 0.25rem;
		}
		.nav-links {
			display: none;
		}
		.nav-search {
			flex: 1;
			padding: 0.25rem 0.25rem 0.25rem 0.5rem;
			gap: 0.5rem;
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
		.layout :global(aside) {
			position: fixed;
		}
		main {
			padding: var(--spacing);
			padding-bottom: calc(var(--spacing) + 4rem);
		}
	}
</style>
