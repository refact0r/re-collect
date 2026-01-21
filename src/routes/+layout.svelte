<script lang="ts">
	import '@fontsource/dm-sans';
	import { PUBLIC_CONVEX_URL } from '$env/static/public';
	import { setupConvex, useQuery } from 'convex-svelte';
	import { setContext } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import favicon from '$lib/assets/favicon.svg';
	import ItemModal from '$lib/components/ItemModal.svelte';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import type { Id } from '../convex/_generated/dataModel.js';
	import { api } from '../convex/_generated/api.js';
	import '../app.css';

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

	let searchQuery = $state('');

	function handleSearch(e: Event) {
		e.preventDefault();
		if (searchQuery.trim()) {
			goto(`/search?q=${encodeURIComponent(searchQuery.trim())}`);
		} else {
			goto('/search');
		}
	}
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<header>
	<nav>
		<div class="nav-links">
			<a href="/">re-collect</a>
			<a href="/collections">collections</a>
			<a href="/search">search</a>
		</div>
		<form class="nav-search" onsubmit={handleSearch}>
			<input type="text" bind:value={searchQuery} placeholder="search..." />
		</form>
	</nav>
</header>

<div class="layout">
	<Sidebar />
	<main>
		{@render children()}
	</main>
</div>

{#if editItemId}
	<ItemModal itemId={editItemId} onClose={closeModal} />
{/if}

<style>
	header {
		padding: 0.5rem 1.5rem;
		border-bottom: 1px solid var(--border);
		flex-shrink: 0;
	}
	nav {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
	}
	.nav-links {
		display: flex;
		gap: 1rem;
	}
	nav a {
		text-decoration: none;
	}
	.nav-search {
		display: flex;
		margin: auto;
	}
	.nav-search input {
		width: 20rem;
		padding: 0.25rem 0.5rem;
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
</style>
