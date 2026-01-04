<script lang="ts">
	import { PUBLIC_CONVEX_URL } from '$env/static/public';
	import { setupConvex } from 'convex-svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import favicon from '$lib/assets/favicon.svg';
	import ItemModal from '$lib/components/ItemModal.svelte';
	import type { Id } from '../convex/_generated/dataModel.js';
	import '../app.css';

	let { children } = $props();
	setupConvex(PUBLIC_CONVEX_URL);

	const editItemId = $derived($page.url.searchParams.get('item') as Id<'items'> | null);

	function closeModal() {
		const url = new URL($page.url);
		url.searchParams.delete('item');
		goto(url.pathname + url.search, { replaceState: false });
	}
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<header>
	<nav>
		<a href="/">re-collect</a>
		<a href="/collections">collections</a>
		<a href="/search">search</a>
	</nav>
</header>

<main>
	{@render children()}
</main>

{#if editItemId}
	<ItemModal itemId={editItemId} onClose={closeModal} />
{/if}

<style>
	header {
		padding: 1rem;
		border-bottom: 1px solid #eee;
	}
	nav {
		display: flex;
		gap: 1rem;
	}
	nav a:first-child {
		font-weight: bold;
	}
	main {
		padding: 1rem;
	}
</style>
