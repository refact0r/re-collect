<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import { page } from '$app/state';
	import { api } from '../../../convex/_generated/api.js';
	import type { Id } from '../../../convex/_generated/dataModel.js';
	import type { FeedCandidate } from '../../../convex/discovery';
	import DiscoverCard from '#lib/components/DiscoverCard.svelte';
	import { useAction, useMutation, useQuery } from '#lib/convex.js';
	import { getCollectionsContext } from '#lib/context.js';
	import { getItemUrl } from '#lib/itemDisplay.js';
	import { pageTitle } from '#lib/pageTitle.svelte.js';
	import IconTune from '~icons/material-symbols-light/tune';
	import IconStream from '~icons/material-symbols-light/view-agenda-outline';
	import IconGrid from '~icons/material-symbols-light/grid-view-outline';

	const PAGE = 30;

	const mutate = useMutation();
	const runAction = useAction();
	const collections = getCollectionsContext();

	$effect(() => {
		pageTitle.value = 'discover';
		return () => (pageTitle.value = null);
	});

	let limit = $state(PAGE);
	const feed = useQuery(api.discovery.feed, () => ({ limit }), { keepPreviousData: true });

	// Cards acted on here leave at once, before the feed query catches up
	const hidden = new SvelteSet<string>();
	const cards = $derived((feed.data?.candidates ?? []).filter((c) => !hidden.has(c._id)));

	let focusIndex = $state(0);
	const focusedId = $derived(cards[Math.min(focusIndex, cards.length - 1)]?._id);

	// Per-browser conveniences
	function stored<T extends string>(key: string, fallback: T): T {
		try {
			return (localStorage.getItem(key) as T) ?? fallback;
		} catch {
			return fallback;
		}
	}
	function store(key: string, value: string) {
		try {
			localStorage.setItem(key, value);
		} catch {
			// Not saved; fine
		}
	}
	let layout = $state(stored<'stream' | 'grid'>('discover:layout', 'stream'));
	// '' is the library itself (no collection)
	let lastKeptInto = $state<string>(stored('discover:lastKeptInto', ''));
	$effect(() => store('discover:layout', layout));
	$effect(() => store('discover:lastKeptInto', lastKeptInto));

	// Where a keep can go, the last one used first (Enter picks it)
	const keepOptions = $derived.by(() => {
		const options = [
			{ id: '', name: 'library' },
			...(collections.data ?? []).map((c) => ({ id: c._id as string, name: c.name }))
		];
		const last = options.findIndex((o) => o.id === lastKeptInto);
		return last > 0 ? [options[last], ...options.toSpliced(last, 1)] : options;
	});

	// The card whose keep picker is open
	let pickerFor = $state<string | null>(null);

	interface Toast {
		text: string;
		undo?: () => void;
		href?: string;
	}
	let toast = $state<Toast | null>(null);
	let toastTimer: ReturnType<typeof setTimeout> | undefined;
	function showToast(next: Toast, ms = 5000) {
		clearTimeout(toastTimer);
		toast = next;
		toastTimer = setTimeout(() => (toast = null), ms);
	}

	let lastSkipped: FeedCandidate | null = null;

	function skip(candidate: FeedCandidate) {
		hidden.add(candidate._id);
		lastSkipped = candidate;
		mutate(api.discovery.skip, { candidateId: candidate._id });
		showToast({ text: 'skipped', undo: () => unskip(candidate) });
	}

	function unskip(candidate: FeedCandidate) {
		mutate(api.discovery.unskip, { candidateId: candidate._id });
		hidden.delete(candidate._id);
		lastSkipped = null;
		toast = null;
	}

	async function keep(candidate: FeedCandidate, optionId: string) {
		const option = keepOptions.find((o) => o.id === optionId);
		if (!option) return;
		pickerFor = null;
		lastKeptInto = option.id;
		hidden.add(candidate._id);
		const into = option.name;
		showToast({ text: `keeping to ${into}…` }, 30_000);
		const itemId = await runAction(api.discoveryKeep.keep, {
			candidateId: candidate._id,
			collectionId: (option.id || undefined) as Id<'collections'> | undefined
		});
		if (!itemId) {
			hidden.delete(candidate._id);
			toast = null;
			return;
		}
		showToast({ text: `kept to ${into}`, href: getItemUrl(itemId) });
	}

	function move(by: number) {
		focusIndex = Math.max(0, Math.min(cards.length - 1, focusIndex + by));
		document
			.querySelector(`[data-candidate="${cards[focusIndex]?._id}"]`)
			?.scrollIntoView({ block: 'center', behavior: 'smooth' });
	}

	function onkeydown(event: KeyboardEvent) {
		const target = event.target as HTMLElement;
		if (target.closest('input, textarea, select, [contenteditable]')) return;
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		if (page.url.searchParams.has('item')) return; // The item modal has the keys

		// While a keep picker is open: 1–9 pick, Enter takes the first, Esc closes
		const picking = cards.find((c) => c._id === pickerFor);
		if (picking) {
			const index = event.key === 'Enter' ? 0 : Number(event.key) - 1;
			if (event.key === 'Escape') pickerFor = null;
			else if (index >= 0 && index < Math.min(9, keepOptions.length)) {
				keep(picking, keepOptions[index].id);
			} else return;
			event.preventDefault();
			return;
		}

		const focused = cards.find((c) => c._id === focusedId);
		switch (event.key) {
			case 'j':
			case 'ArrowDown':
				move(1);
				break;
			case 'k':
			case 'ArrowUp':
				move(-1);
				break;
			case 'x':
				if (focused) skip(focused);
				break;
			case 's':
				if (focused) pickerFor = focused._id;
				break;
			case 'u':
				if (lastSkipped) unskip(lastSkipped);
				break;
			case 'o':
				if (focused) window.open(focused.url, '_blank', 'noopener');
				break;
			default:
				return;
		}
		event.preventDefault();
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

	let showSources = $state(false);

	const sinceText = (ms: number | null) => {
		if (!ms) return 'never';
		const minutes = Math.round((Date.now() - ms) / 60_000);
		if (minutes < 60) return `${minutes}m ago`;
		return `${Math.round(minutes / 60)}h ago`;
	};
</script>

<svelte:window
	{onkeydown}
	onpointerdown={(e) => {
		if (pickerFor && !(e.target as Element).closest('.picker, .keep')) pickerFor = null;
	}}
/>

<div class="discover">
	<div class="toolbar">
		<div class="heading">
			<h1>discover</h1>
			{#if feed.data}
				<span class="meta">
					{cards.length + feed.data.remaining} new · {feed.data.kept} kept · {feed.data.skipped} skipped
				</span>
			{/if}
		</div>
		<div class="controls">
			<div class="mode-options layout-toggle">
				<button
					class:active={layout === 'stream'}
					onclick={() => (layout = 'stream')}
					aria-label="stream"
					title="stream"><IconStream /></button
				>
				<button
					class:active={layout === 'grid'}
					onclick={() => (layout = 'grid')}
					aria-label="grid"
					title="grid"><IconGrid /></button
				>
			</div>
			<button
				class="icon"
				class:active={showSources}
				onclick={() => (showSources = !showSources)}
				aria-label="sources"
				title="sources"
			>
				<IconTune />
			</button>
		</div>
	</div>

	{#if showSources && feed.data}
		<section class="sources">
			<ul>
				{#each feed.data.sources as source (source.key)}
					<li>
						<label class="source-name">
							<input
								type="checkbox"
								checked={!source.hidden}
								onchange={(e) =>
									mutate(api.discovery.setSourceHidden, {
										key: source.key,
										hidden: !e.currentTarget.checked
									})}
							/>
							{source.name}
						</label>
						<span class="meta" class:error={source.lastError} title={source.lastError ?? undefined}>
							{source.lastError ? 'failed' : 'checked'}
							{sinceText(source.lastPolledAt)}
						</span>
					</li>
				{/each}
			</ul>
			<div class="sources-footer">
				<span class="meta"
					>keys: j/k move · s keep (then 1–9 or enter) · x skip · u undo · o open</span
				>
				<button onclick={() => mutate(api.discovery.resetSkips, {})}>show skipped again</button>
			</div>
		</section>
	{/if}

	{#if feed.isLoading && !feed.data}
		<p class="status-text">loading...</p>
	{:else if feed.error}
		<p class="status-text">error: {feed.error.message}</p>
	{:else if cards.length === 0}
		<p class="status-text">
			{feed.data?.sources.every((s) => s.hidden)
				? 'every source is turned off'
				: "you're all caught up"}
		</p>
	{:else}
		<div class="feed {layout}">
			{#each cards as candidate (candidate._id)}
				<DiscoverCard
					{candidate}
					focused={candidate._id === focusedId}
					onFocus={() => (focusIndex = cards.indexOf(candidate))}
					picking={pickerFor === candidate._id}
					{keepOptions}
					onKeep={() => (pickerFor = pickerFor === candidate._id ? null : candidate._id)}
					onPick={(id) => keep(candidate, id)}
					onSkip={() => skip(candidate)}
				/>
			{/each}
		</div>
		<div {@attach loadMore}></div>
	{/if}
</div>

{#if toast}
	<div class="toast" role="status">
		<span>{toast.text}</span>
		{#if toast.undo}
			<button onclick={toast.undo}>undo</button>
		{/if}
		{#if toast.href}
			<a href={toast.href}>open</a>
		{/if}
	</div>
{/if}

<style>
	.discover {
		max-width: 40rem;
		margin: 0 auto;
		padding-bottom: 4rem;
	}
	.discover:has(.feed.grid) {
		max-width: none;
	}
	.toolbar {
		display: flex;
		justify-content: space-between;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-bottom: var(--spacing);
	}
	.heading {
		display: flex;
		align-items: baseline;
		gap: 0.75rem;
	}
	.controls {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}
	.layout-toggle button {
		padding: 0.375rem;
	}
	.layout-toggle button.active,
	button.icon.active {
		background: var(--bg-3);
		color: var(--txt-1);
	}
	.controls :global(svg) {
		width: 1.25rem;
		height: 1.25rem;
	}
	.sources {
		border: 1px solid var(--border);
		padding: 0.75rem;
		margin-bottom: var(--spacing);
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.sources ul {
		list-style: none;
		display: grid;
		gap: 0.125rem;
	}
	.sources li {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		min-height: 2rem;
	}
	.source-name {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		cursor: pointer;
	}
	.source-name input {
		accent-color: var(--txt-2);
	}
	.error {
		color: oklch(70% 0.12 20);
	}
	.sources-footer {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.feed.grid {
		columns: 20rem;
		column-gap: var(--spacing);
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
		background: var(--bg-3);
		border: 1px solid var(--txt-3);
		color: var(--txt-1);
		z-index: 50;
	}
	.toast button {
		padding: 0 0.5rem;
		background: transparent;
	}
	.toast a {
		color: var(--txt-1);
	}
</style>
