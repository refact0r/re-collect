<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { page } from '$app/state';
	import IconAdd from '~icons/material-symbols-light/add-sharp';
	import IconRemove from '~icons/material-symbols-light/remove-sharp';
	import IconFit from '~icons/material-symbols-light/fit-screen-sharp';
	import IconLabel from '~icons/material-symbols-light/label-outline-sharp';
	import IconSelect from '~icons/material-symbols-light/ink-selection-sharp';
	import IconSmaller from '~icons/material-symbols-light/photo-size-select-small-sharp';
	import IconLarger from '~icons/material-symbols-light/photo-size-select-large-sharp';
	import IconPanelClose from '~icons/material-symbols-light/right-panel-close-sharp';
	import IconPanelOpen from '~icons/material-symbols-light/right-panel-open-sharp';
	import type { Id } from '../../../convex/_generated/dataModel.js';
	import {
		colorWheel,
		findRegions,
		litItems,
		noLenses,
		fontsByUse,
		toggled,
		UNCOLLECTED,
		type Lenses
	} from '#lib/atlas.js';
	import { getCollectionsContext, getItemsContext } from '#lib/context.js';
	import { useCurrentItems } from '#lib/currentItems.svelte.js';
	import { useLibraryMap } from '#lib/libraryMap.svelte.js';
	import { usePageTitle } from '#lib/pageTitle.svelte.js';
	import LensPanel from '#lib/components/atlas/LensPanel.svelte';
	import MapCanvas, { type Placed } from '#lib/components/atlas/MapCanvas.svelte';
	import SelectionPanel from '#lib/components/atlas/SelectionPanel.svelte';

	type ItemId = Id<'items'>;

	const itemsQuery = getItemsContext();
	const collections = getCollectionsContext();
	const map = useLibraryMap();

	usePageTitle(() => 'atlas');

	const items = $derived(itemsQuery.data ?? []);
	const byId = $derived(new Map(items.map((item) => [item._id, item])));
	// The map's points whose item still exists, and those items
	const points = $derived(map.points.filter((p) => byId.has(p.itemId)));
	const mapped = $derived(points.map((p) => byId.get(p.itemId)!));
	const mappedById = $derived(new Map(mapped.map((item) => [item._id, item])));
	// The item modal steps through the items on the map
	useCurrentItems(() => mapped);

	/* Arrangement: where each item sits */

	const arrangements = [
		{ value: 'look', label: 'by look' },
		{ value: 'color', label: 'by color' }
	] as const;
	let arrangement = $state<(typeof arrangements)[number]['value']>('look');

	const wheel = $derived(colorWheel(mapped));
	const placed = $derived(
		points.flatMap((p): Placed[] => {
			const at = arrangement === 'color' ? wheel.get(p.itemId) : p;
			return at ? [{ item: byId.get(p.itemId)!, x: at.x, y: at.y }] : [];
		})
	);
	// On the wheel each item wears the color it was placed by
	const rings = $derived(
		arrangement === 'color' ? new Map([...wheel].map(([id, at]) => [id, at.hex])) : null
	);

	function arrange(next: typeof arrangement) {
		arrangement = next;
		canvas?.fit();
	}

	/* Regions: named groups of look-alikes, labelled on the map */

	const regions = $derived(findRegions(points, items));
	let showLabels = $state(true);
	const labels = $derived(
		arrangement === 'look' && showLabels
			? regions.map((r) => ({ id: r.id, text: r.name, count: r.itemIds.length, x: r.x, y: r.y }))
			: []
	);

	/* Lenses: what's lit */

	let lenses = $state.raw<Lenses>(noLenses());
	const lit = $derived(litItems(mapped, lenses));
	const litCount = $derived(lit?.size ?? mapped.length);

	// A deleted collection stops filtering along with its row
	$effect(() => {
		if (!collections.data) return;
		const existing = new Set<string>(collections.data.map((c) => c._id));
		const kept = [...lenses.collections].filter((id) => id === UNCOLLECTED || existing.has(id));
		if (kept.length < lenses.collections.size) lenses = { ...lenses, collections: new Set(kept) };
	});

	function toggleStyle(style: string) {
		lenses = { ...lenses, styles: toggled(lenses.styles, style) };
	}

	// The time-lapse: the library growing in the order it was saved
	let playing = $state(false);
	let playTimer: ReturnType<typeof setInterval> | undefined;
	let playedTo = $state<number>();

	function stop() {
		clearInterval(playTimer);
		playing = false;
		playedTo = undefined;
		lenses = { ...lenses, added: null };
	}

	function play() {
		if (playing) return stop();
		const dates = mapped.map((item) => item.dateAdded).sort((a, b) => a - b);
		if (dates.length < 2) return;
		playing = true;
		let i = 0;
		const step = () => {
			if (i >= dates.length) return stop();
			playedTo = dates[i];
			lenses = { ...lenses, added: [dates[0], dates[i++]] };
		};
		step();
		playTimer = setInterval(step, Math.max(40, Math.min(160, 9000 / dates.length)));
	}

	onDestroy(() => clearInterval(playTimer));

	const playedLabel = $derived(
		playedTo &&
			new Date(playedTo)
				.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
				.toLowerCase()
	);

	/* Selection: what takes the panel over from the filters */

	let selectedIds = $state.raw<ItemId[]>([]);
	let fromRegion = $state(false);
	const selected = $derived(selectedIds.flatMap((id) => mappedById.get(id) ?? []));
	const selectedSet = $derived(new Set(selected.map((item) => item._id)));
	// The region a selection came from, found by its items since a recompute reassigns ids
	const selectedRegion = $derived(
		fromRegion
			? regions.find(
					(r) =>
						r.itemIds.length === selected.length && r.itemIds.every((id) => selectedSet.has(id))
				)
			: undefined
	);

	function select(ids: ItemId[], region = false) {
		// the panel opening for a selection, or closing with it, resizes the map
		if (!panelOpen && ids.length > 0 !== selected.length > 0) canvas?.glide();
		selectedIds = ids;
		fromRegion = region;
	}

	// The items closest to one on the map by look, whatever the arrangement
	function nearby(id: ItemId, count = 8): ItemId[] {
		const at = points.find((p) => p.itemId === id);
		if (!at) return [];
		return points
			.filter((p) => p !== at)
			.map((p) => ({ id: p.itemId, d: (p.x - at.x) ** 2 + (p.y - at.y) ** 2 }))
			.sort((a, b) => a.d - b.d)
			.slice(0, count)
			.map((p) => p.id);
	}
	const neighbours = $derived(
		selected.length === 1 ? nearby(selected[0]._id).flatMap((id) => byId.get(id) ?? []) : []
	);

	function pick(id: ItemId, toggle: boolean) {
		if (!toggle) return select([id]);
		select(selectedSet.has(id) ? selectedIds.filter((s) => s !== id) : [...selectedIds, id]);
	}

	// Selects one item and brings it and its surroundings into view
	function focus(id: ItemId) {
		select([id]);
		canvas?.fit(arrangement === 'look' ? [id, ...nearby(id)] : [id]);
	}

	function selectRegion(id: number) {
		const region = regions.find((r) => r.id === id);
		if (!region) return;
		select(region.itemIds, true);
		canvas?.fit(region.itemIds);
	}

	let canvas = $state<MapCanvas>();
	const sizes = [32, 48, 72, 104, 152, 220, 320];
	let thumb = $state(72);
	const resize = (step: number) => (thumb = sizes[sizes.indexOf(thumb) + step] ?? thumb);
	let boxMode = $state(false);

	// The panel beside the map: the filters, or the selection while there is one
	let panelOpen = $state(true);
	const panelShown = $derived(mapped.length > 0 && (panelOpen || selected.length > 0));

	function togglePanel() {
		canvas?.glide();
		const show = !panelShown;
		if (!show) select([]);
		panelOpen = show;
	}

	// A link from the patterns page opens the map on what it was about
	let opened = false;
	$effect(() => {
		if (opened || points.length === 0 || !canvas) return;
		opened = true;
		untrack(() => {
			const params = page.url.searchParams;
			// a phone has no room for the panel, region names or big thumbnails
			if (window.matchMedia('(max-width: 768px)').matches) {
				panelOpen = false;
				showLabels = false;
				thumb = 48;
			}
			const style = params.get('style');
			if (style) lenses = { ...noLenses(), styles: new Set([style]) };
			// against every item, as the patterns page lists them; the ones off the map just don't light
			const font = fontsByUse(items).find((f) => f.query === params.get('font'));
			if (font) {
				const found = { query: font.name, words: false, hits: new Set(font.itemIds) };
				lenses = { ...noLenses(), found };
			}
			if (params.has('region')) selectRegion(Number(params.get('region')));
			const item = params.get('focus') as ItemId | null;
			if (item && mappedById.has(item)) focus(item);
		});
	});
</script>

<div class="atlas">
	<div class="stage">
		<MapCanvas
			bind:this={canvas}
			points={placed}
			{lit}
			hideUnlit={playing}
			selected={selectedSet}
			{labels}
			{thumb}
			{rings}
			{boxMode}
			inset={56}
			onpick={pick}
			onbox={(ids) => ids.length > 0 && select(ids)}
			onlabel={selectRegion}
			onclear={() => select([])}
		>
			{#snippet empty()}
				{#if itemsQuery.isLoading}
					loading...
				{:else if itemsQuery.error}
					error: {itemsQuery.error.message}
				{:else if map.pending}
					mapping the library...
				{:else if map.failed}
					couldn't map the library
				{:else}
					nothing to map yet
				{/if}
			{/snippet}
		</MapCanvas>

		{#if playedLabel}
			<p class="caption">{playedLabel} <span>{litCount}</span></p>
		{/if}

		<div class="bottom">
			<span class="status-text">
				{#if map.updating && placed.length > 0}
					updating map...
				{:else if map.failed && placed.length > 0}
					couldn't update the map
				{/if}
			</span>
			<div class="tools">
				<div class="mode-options">
					{#each arrangements as option (option.value)}
						<button
							class={{ active: arrangement === option.value }}
							onclick={() => arrange(option.value)}
							disabled={points.length === 0 || (option.value === 'color' && wheel.size === 0)}
						>
							{option.label}
						</button>
					{/each}
				</div>
				<div class="group">
					<button
						class={['icon', { active: showLabels }]}
						aria-pressed={showLabels}
						title="region names"
						onclick={() => (showLabels = !showLabels)}
						disabled={arrangement !== 'look' || regions.length === 0}
					>
						<IconLabel />
					</button>
					<button
						class={['icon', { active: boxMode }]}
						aria-pressed={boxMode}
						title="drag to select (or hold shift)"
						onclick={() => (boxMode = !boxMode)}
						disabled={placed.length === 0}
					>
						<IconSelect />
					</button>
				</div>
				<div class="group sizes">
					<button
						class="icon"
						title="smaller thumbnails"
						onclick={() => resize(-1)}
						disabled={thumb === sizes[0]}
					>
						<IconSmaller />
					</button>
					<button
						class="icon"
						title="larger thumbnails"
						onclick={() => resize(1)}
						disabled={thumb === sizes.at(-1)}
					>
						<IconLarger />
					</button>
				</div>
				<div class="group">
					<button
						class="icon"
						title="zoom in"
						onclick={() => canvas?.zoomBy(1.5)}
						disabled={placed.length === 0}
					>
						<IconAdd />
					</button>
					<button
						class="icon"
						title="zoom out"
						onclick={() => canvas?.zoomBy(1 / 1.5)}
						disabled={placed.length === 0}
					>
						<IconRemove />
					</button>
					<button
						class="icon"
						title="fit the map"
						onclick={() => canvas?.fit()}
						disabled={placed.length === 0}
					>
						<IconFit />
					</button>
				</div>
				<div class="group">
					<button
						class="icon"
						title={panelShown ? 'hide the panel' : 'show filters'}
						aria-expanded={panelShown}
						onclick={togglePanel}
						disabled={mapped.length === 0}
					>
						{#if panelShown}
							<IconPanelClose />
						{:else}
							<IconPanelOpen />
						{/if}
					</button>
				</div>
			</div>
		</div>
	</div>

	{#if mapped.length > 0}
		<aside class={{ shown: panelShown }}>
			<!-- kept mounted under a selection, so the filters come back as they were -->
			<div class={['slot', { covered: selected.length > 0 }]}>
				<LensPanel
					items={mapped}
					collections={collections.data ?? []}
					{lenses}
					onchange={(next) => (lenses = next)}
					lit={lit?.size ?? null}
					{playing}
					onplay={play}
					onselect={() => lit && select([...lit])}
				/>
			</div>
			{#if selected.length > 0}
				<div class="slot">
					<SelectionPanel
						{selected}
						region={selectedRegion}
						{neighbours}
						collections={collections.data ?? []}
						activeStyles={lenses.styles}
						onpick={focus}
						onstyle={toggleStyle}
						onclose={() => select([])}
					/>
				</div>
			{/if}
		</aside>
	{/if}
</div>

<style>
	/* The page is the map and the panel docked beside it, with no page scroll */
	.atlas {
		position: absolute;
		inset: 0;
		display: flex;
		overflow: hidden;
	}

	.stage {
		position: relative;
		flex: 1;
		min-width: 0;
	}

	aside {
		display: none;
		flex-shrink: 0;
		width: 19rem;
		min-height: 0;
		background: var(--bg-1);
		border-left: 1px solid var(--border);
	}

	aside.shown {
		display: block;
	}

	.slot {
		height: 100%;
		min-height: 0;
	}

	.slot.covered {
		display: none;
	}

	.caption {
		position: absolute;
		left: 50%;
		bottom: 4rem;
		z-index: 9;
		transform: translateX(-50%);
		font-size: var(--text-xl);
		font-weight: 500;
		letter-spacing: -0.02ch;
		color: var(--txt-1);
		white-space: nowrap;
		pointer-events: none;
	}

	.caption span {
		color: var(--txt-3);
		font-variant-numeric: tabular-nums;
	}

	.bottom {
		position: absolute;
		left: 0.75rem;
		right: 0.75rem;
		bottom: 0.75rem;
		z-index: 10;
		display: flex;
		justify-content: center;
		align-items: center;
		pointer-events: none;
	}

	/* off to the side, so the controls stay centred under the map */
	.bottom .status-text {
		position: absolute;
		left: 0;
	}

	.tools {
		display: flex;
		gap: var(--gap);
		pointer-events: auto;
	}

	.tools .mode-options,
	.group {
		display: flex;
		background: var(--bg-1);
	}

	.group {
		border: 1px solid var(--border);
	}

	.tools button {
		padding: var(--pad-y-sm) var(--pad-x-sm);
		font-size: var(--text-sm);
	}

	.tools button.icon {
		padding: var(--pad-y-sm);
	}

	.tools button.icon.active {
		background: var(--bg-3);
		color: var(--txt-1);
	}

	.tools button :global(svg) {
		width: 1.25rem;
		height: 1.25rem;
	}

	@media (max-width: 768px) {
		/* the panel becomes a sheet under the map, which shrinks to make room,
		   keeping its controls in reach */
		.atlas {
			flex-direction: column;
		}

		.stage {
			min-height: 0;
		}

		aside {
			width: auto;
			height: 60%;
			border-left: none;
			border-top: 1px solid var(--border);
		}

		.bottom {
			left: 0.5rem;
			right: 0.5rem;
			bottom: 0.5rem;
		}

		.bottom .status-text,
		.sizes {
			display: none;
		}
	}
</style>
