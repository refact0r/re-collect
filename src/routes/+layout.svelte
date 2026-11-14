<script lang="ts">
	import '@fontsource/dm-sans';
	import '@fontsource/dm-sans/500.css';
	import '../app.css';
	import { dev } from '$app/env';
	import { page } from '$app/state';
	import { pageTitle } from '#lib/pageTitle.svelte.js';

	let { children } = $props();

	const name = $derived(pageTitle.value ?? (page.data.title as string | undefined));
</script>

<svelte:head>
	<title>{dev ? 'DEV ' : ''}{name ? `${name} · ` : ''}re-collect</title>
	<link rel="icon" type="image/svg+xml" href={dev ? '/favicon-dev.svg' : '/favicon.svg'} />
</svelte:head>

{@render children()}
