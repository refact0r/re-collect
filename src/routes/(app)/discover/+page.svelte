<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import { api } from '../../../convex/_generated/api.js';
	import type { Id } from '../../../convex/_generated/dataModel.js';
	import type { FeedCandidate } from '../../../convex/discovery';
	import ColumnControl from '#lib/components/ColumnControl.svelte';
	import DiscoverGrid from '#lib/components/DiscoverGrid.svelte';
	import DiscoverModal from '#lib/components/DiscoverModal.svelte';
	import SourceFilter from '#lib/components/SourceFilter.svelte';
	import { useAction, useMutation, useQuery } from '#lib/convex.js';
	import { getCollectionsContext } from '#lib/context.js';
	import { getItemUrl } from '#lib/itemDisplay.js';
	import { pageTitle } from '#lib/pageTitle.svelte.js';
	import { useViewPrefs } from '#lib/prefs.svelte.js';

	const PAGE = 30;

	const mutate = useMutation();
	const runAction = useAction();
	const collections = getCollectionsContext();
	const prefs = useViewPrefs('discover');

	$effect(() => {
		pageTitle.value = 'discover';
		return () => (pageTitle.value = null);
	});

	let limit = $state(PAGE);
	const feed = useQuery(api.discovery.feed, () => ({ limit }), { keepPreviousData: true });

	// Added cards leave at once, before the feed query catches up
	const added = new SvelteSet<string>();
	const cards = $derived((feed.data?.candidates ?? []).filter((c) => !added.has(c._id)));

	// Where an add can go, the last one used first. '' is the library alone.
	let lastAddedTo = $state(stored('discover:lastAddedTo'));
	const options = $derived.by(() => {
		const all = [
			{ id: '', name: 'library' },
			...(collections.data ?? []).map((c) => ({ id: c._id as string, name: c.name }))
		];
		const last = all.findIndex((o) => o.id === lastAddedTo);
		return last > 0 ? [all[last], ...all.toSpliced(last, 1)] : all;
	});

	function stored(key: string) {
		try {
			return localStorage.getItem(key) ?? '';
		} catch {
			return '';
		}
	}
	$effect(() => {
		try {
			localStorage.setItem('discover:lastAddedTo', lastAddedTo);
		} catch {
			// Not remembered; fine
		}
	});

	let open = $state<FeedCandidate | null>(null);

	let toast = $state<{ text: string; href?: string } | null>(null);
	let toastTimer: ReturnType<typeof setTimeout> | undefined;
	function showToast(next: typeof toast, ms = 5000) {
		clearTimeout(toastTimer);
		toast = next;
		toastTimer = setTimeout(() => (toast = null), ms);
	}

	async function add(candidate: FeedCandidate, optionId: string) {
		const option = options.find((o) => o.id === optionId);
		if (!option) return;
		open = null;
		lastAddedTo = option.id;
		added.add(candidate._id);
		showToast({ text: `adding to ${option.name}...` }, 30_000);
		const itemId = await runAction(api.discoveryKeep.keep, {
			candidateId: candidate._id,
			collectionId: (option.id || undefined) as Id<'collections'> | undefined
		});
		if (!itemId) {
			added.delete(candidate._id);
			toast = null;
			return;
		}
		showToast({ text: `added to ${option.name}`, href: getItemUrl(itemId) });
	}

	// Infinite scroll: grow the window as the end comes into view
	function loadMore(node: HTMLElement) {
		const observer = new IntersectionObserver(
			([entry]) => {
				if (entry.isIntersecting && (feed.data?.remaining ?? 0) > 0 && !feed.isLoading) {
					limit += PAGE;
				}
			},
			{ rootMargin: '1200px' }
		);
		observer.observe(node);
		return () => observer.disconnect();
	}
</script>

<div class="page-header">
	<h1>discover</h1>
	<div class="controls">
		{#if feed.data}
			<SourceFilter
				sources={feed.data.sources}
				onchange={(key, hidden) => mutate(api.discovery.setSourceHidden, { key, hidden })}
			/>
		{/if}
		<ColumnControl
			value={prefs.columnOffset}
			onchange={(columnOffset) => prefs.set({ columnOffset })}
		/>
	</div>
</div>

{#if feed.error}
	<p class="status-text">error: {feed.error.message}</p>
{:else if !feed.data}
	<p class="status-text">loading...</p>
{:else if cards.length === 0}
	<p class="status-text">
		{feed.data.sources.every((s) => s.hidden)
			? 'every source is turned off.'
			: 'nothing new right now.'}
	</p>
{:else}
	<DiscoverGrid candidates={cards} columnOffset={prefs.columnOffset} onOpen={(c) => (open = c)} />
	<div class="end" {@attach loadMore}></div>
{/if}

{#if open}
	{@const candidate = open}
	<DiscoverModal
		{candidate}
		{options}
		onAdd={(id) => add(candidate, id)}
		onClose={() => (open = null)}
	/>
{/if}

{#if toast}
	<div class="toast" role="status">
		<span>{toast.text}</span>
		{#if toast.href}<a href={toast.href}>open</a>{/if}
	</div>
{/if}

<style>
	.controls {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}

	.end {
		height: 2rem;
	}

	.toast {
		position: fixed;
		bottom: 1.5rem;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.5rem 0.75rem;
		background: var(--bg-2);
		border: 1px solid var(--border);
		z-index: 50;
	}

	.toast a {
		color: var(--txt-1);
	}
</style>
