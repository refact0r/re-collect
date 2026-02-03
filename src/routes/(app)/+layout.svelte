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
	import IconMenu from '~icons/material-symbols/menu-sharp';

	let { children } = $props();
	setupConvex(PUBLIC_CONVEX_URL);

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

<header>
	<nav>
		<button class="icon menu-btn" onclick={toggleMobileMenu} aria-label="toggle menu">
			<IconMenu />
		</button>
		<div class="nav-links">
			<a href="/" class:active={page.url.pathname === '/'}>re-collect</a>
			<a href="/collections" class:active={page.url.pathname === '/collections'}>collections</a>
		</div>
		<div class="nav-search">
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
			<a href="/logout" class="logout-link">logout</a>
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
		padding: 0.5rem 1rem 0.5rem 1.5rem;
		border-bottom: 1px solid var(--border);
		flex-shrink: 0;
	}
	nav {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
	}
	.menu-btn {
		display: none;
	}
	.menu-btn :global(svg) {
		width: 1.5rem;
		height: 1.5rem;
	}
	.nav-links {
		display: flex;
		gap: 1rem;
	}
	nav a {
		text-decoration: none;
	}
	nav a:hover {
		color: var(--txt-1);
	}
	nav a.active {
		color: var(--txt-1);
	}
	.nav-search {
		display: flex;
		/* margin: auto; */
	}
	.nav-search input {
		width: 24rem;
		padding: 0.25rem 0.5rem;
	}
	.nav-actions {
		display: flex;
		align-items: center;
	}
	.logout-link {
		text-decoration: none;
		color: var(--txt-2);
		font-size: 0.875rem;
	}
	.logout-link:hover {
		color: var(--txt-1);
	}
	.mobile-backdrop {
		display: none;
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
		padding: 1rem;
		overflow-y: auto;
	}

	@media (max-width: 768px) {
		header {
			padding: 0.5rem 0.75rem;
		}
		.menu-btn {
			display: flex;
		}
		.nav-links {
			display: none;
		}
		.nav-search input {
			width: 100%;
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
			padding: 0.75rem;
		}
	}
</style>
