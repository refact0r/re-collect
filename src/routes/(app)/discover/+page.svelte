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
	import { getCollectionsContext, getItemsContext } from '#lib/context.js';
	import { getItemUrl } from '#lib/itemDisplay.js';
	import { dismiss, notify } from '#lib/notice.svelte.js';
	import { usePageTitle } from '#lib/pageTitle.svelte.js';
	import { useViewPrefs } from '#lib/prefs.svelte.js';

	const PAGE = 30;

	const mutate = useMutation();
	const runAction = useAction();
	const items = getItemsContext();
	const collections = getCollectionsContext();
	const prefs = useViewPrefs('discover');

	usePageTitle(() => 'discover');

	let limit = $state(PAGE);
	const feed = useQuery(api.discovery.feed, () => ({ limit }), { keepPreviousData: true });

	// Added cards leave at once, before the feed query catches up. Once the feed
	// has dropped one, so does this, so it comes back if deleted from the library
	const added = new SvelteSet<string>();
	const cards = $derived((feed.data?.candidates ?? []).filter((c) => !added.has(c._id)));
	$effect(() => {
		if (!feed.data) return;
		const inFeed = new Set<string>(feed.data.candidates.map((c) => c._id));
		for (const id of added) if (!inFeed.has(id)) added.delete(id);
	});

	// Where an add can go, the last one used first. '' is the library alone,
	// in no collection
	let lastAddedTo = $state(stored('discover:lastAddedTo'));
	const options = $derived.by(() => {
		const all = [
			{
				id: '',
				name: 'uncollected',
				count: items.data?.filter((i) => i.collections.length === 0).length
			},
			...(collections.data ?? []).map((c) => ({
				id: c._id as string,
				name: c.name,
				count: c.itemCount
			}))
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

	async function add(candidate: FeedCandidate, optionId: string) {
		const option = options.find((o) => o.id === optionId);
		if (!option) return;
		open = null;
		lastAddedTo = option.id;
		added.add(candidate._id);
		const where = option.id ? option.name : 'library';
		const adding = notify(`adding to ${where}...`, { duration: 30_000 });
		const itemId = await runAction(api.discoveryKeep.keep, {
			candidateId: candidate._id,
			collectionId: (option.id || undefined) as Id<'collections'> | undefined
		});
		if (!itemId) {
			added.delete(candidate._id);
			dismiss(adding);
			return;
		}
		notify(`added to ${where}`, {
			link: { href: getItemUrl(itemId), label: 'open' },
			replaces: adding
		});
	}

	// Infinite scroll: grow the window while the end is in view, checked again
	// each time a page arrives (it may not push the end out of view)
	let nearEnd = $state(false);
	$effect(() => {
		if (nearEnd && !feed.isStale && feed.data?.more) limit += PAGE;
	});

	function watchEnd(node: HTMLElement) {
		const observer = new IntersectionObserver(([entry]) => (nearEnd = entry.isIntersecting), {
			rootMargin: '1200px'
		});
		observer.observe(node);
		return () => {
			observer.disconnect();
			nearEnd = false;
		};
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
	<div class="end" {@attach watchEnd}></div>
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

<style>
	.controls {
		display: flex;
		gap: var(--gap);
		align-items: center;
	}

	.end {
		height: 2rem;
	}
</style>
