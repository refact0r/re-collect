<script lang="ts">
	import '@fontsource/dm-sans';
	import '../app.css';
	import { dev } from '$app/environment';

	let { children } = $props();
</script>

<svelte:head>
	<title>{dev ? 'DEV re-collect' : 're-collect'}</title>
	<link rel="icon" type="image/svg+xml" href={dev ? '/favicon-dev.svg' : '/favicon.svg'} />
</svelte:head>

{@render children()}
