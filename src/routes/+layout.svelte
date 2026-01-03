<script lang="ts">
	import { PUBLIC_CONVEX_URL } from '$env/static/public';
	import { setupConvex } from 'convex-svelte';
	import favicon from '$lib/assets/favicon.svg';
	import '../app.css';

	let { children } = $props();
	setupConvex(PUBLIC_CONVEX_URL);
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
