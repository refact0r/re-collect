<script lang="ts">
	import type { Id } from '../../../convex/_generated/dataModel.js';
	import {
		findRegions,
		fontPairings,
		itemLabel,
		recentShift,
		styleGraph,
		fontsByUse,
		type MapPoint,
		type Region,
		type Shift
	} from '#lib/atlas.js';
	import StyleConstellation from '#lib/components/atlas/StyleConstellation.svelte';
	import { getCollectionsContext, getItemsContext } from '#lib/context.js';
	import { useCurrentItems } from '#lib/currentItems.svelte.js';
	import { getItemUrl, shouldDisplayAsImage } from '#lib/itemDisplay.js';
	import { useLibraryMap } from '#lib/libraryMap.svelte.js';
	import { usePageTitle } from '#lib/pageTitle.svelte.js';
	import type { DisplayItem } from '#lib/types.js';

	type ItemId = Id<'items'>;

	const itemsQuery = getItemsContext();
	const collections = getCollectionsContext();
	const map = useLibraryMap();

	// The item modal steps through the whole library
	useCurrentItems(() => itemsQuery.data ?? []);

	usePageTitle(() => 'patterns');

	const items = $derived(itemsQuery.data ?? []);
	const byId = $derived(new Map(items.map((item) => [item._id, item])));
	const points = $derived(map.points.filter((p) => byId.has(p.itemId)));
	// The sections below the totals are about how things look, so they read only
	// the items on the map, where each of their links lands
	const mapped = $derived(points.map((p) => byId.get(p.itemId)!));
	const pointById = $derived(new Map(points.map((p) => [p.itemId, p])));
	const lookup = (ids: ItemId[]) => ids.flatMap((itemId) => byId.get(itemId) ?? []);

	const firstAdded = $derived(
		items.length ? Math.min(...items.map((item) => item.dateAdded)) : null
	);

	const stats = $derived([
		{ label: 'items', value: items.length },
		{ label: 'collections', value: collections.data?.length ?? 0 },
		{ label: 'styles', value: new Set(items.flatMap((item) => item.styles ?? [])).size },
		{ label: 'tags', value: new Set(items.flatMap((item) => item.aiTags ?? [])).size },
		{ label: 'colors', value: items.reduce((sum, item) => sum + (item.paletteHex?.length ?? 0), 0) }
	]);

	const regions = $derived(findRegions(points, mapped));
	const shift = $derived(recentShift(regions, mapped));
	const graph = $derived(styleGraph(mapped));
	// How many of a font's sites its row shows; the atlas has the rest
	const FONT_SITES = 5;
	const fonts = $derived(fontsByUse(mapped));
	const pairings = $derived(fontPairings(mapped));

	const rising = $derived(shift?.shifts.filter((s) => s.share > s.before).slice(0, 3) ?? []);
	const falling = $derived(
		shift?.shifts
			.filter((s) => s.share < s.before)
			.reverse()
			.slice(0, 2) ?? []
	);

	const monthYear = (time: number) =>
		new Date(time).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toLowerCase();

	function shortDate(time: number) {
		const date = new Date(time);
		const sameYear = date.getFullYear() === new Date().getFullYear();
		return date
			.toLocaleDateString('en-US', {
				month: 'short',
				day: 'numeric',
				...(!sameYear && { year: 'numeric' })
			})
			.toLowerCase();
	}

	const percent = (share: number) => `${Math.round(share * 100)}%`;

	// A region's items, the ones nearest its middle first
	function typical(region: Region, limit: number) {
		const distance = (p: MapPoint) => (p.x - region.x) ** 2 + (p.y - region.y) ** 2;
		return lookup(
			[...region.itemIds]
				.sort((a, b) => distance(pointById.get(a)!) - distance(pointById.get(b)!))
				.slice(0, limit)
		);
	}

	// The distinctive styles left over once the two in the name are taken
	function moreStyles(region: Region) {
		const named = new Set(region.named);
		return region.styles.filter((style) => !named.has(style)).slice(0, 3);
	}

	function recentIn(s: Shift, recentIds: Set<ItemId>) {
		return lookup(s.region.itemIds.filter((id) => recentIds.has(id)))
			.sort((a, b) => b.dateAdded - a.dateAdded)
			.slice(0, 6);
	}
</script>

{#snippet thumb(item: DisplayItem)}
	{#if shouldDisplayAsImage(item)}
		<img
			src={item.imageUrl}
			srcset={item.imageSrcset}
			sizes="6rem"
			alt=""
			loading="lazy"
			decoding="async"
		/>
	{:else}
		<span class="chip">{itemLabel(item)}</span>
	{/if}
{/snippet}

{#snippet thumbLink(item: DisplayItem)}
	<a
		href={getItemUrl(item._id)}
		class="thumb-link"
		aria-label={itemLabel(item)}
		title={itemLabel(item)}
	>
		{@render thumb(item)}
	</a>
{/snippet}

<div class="page-column">
	<div class="page-header">
		<h1>patterns</h1>
		{#if firstAdded !== null}
			<p class="meta">collecting since {monthYear(firstAdded)}</p>
		{/if}
	</div>

	<!-- Wait for the map too: the items may already be cached from another page,
	     and the sections that don't need the map would render first, then jump -->
	{#if itemsQuery.isLoading || map.loading}
		<p class="status-text">loading...</p>
	{:else if itemsQuery.error}
		<p class="status-text">error: {itemsQuery.error.message}</p>
	{:else if items.length === 0}
		<p class="status-text">nothing saved yet</p>
	{:else}
		<div class="stats">
			{#each stats as stat (stat.label)}
				<div class="stat">
					<span class="stat-value">{stat.value}</span>
					<span class="stat-label">{stat.label}</span>
				</div>
			{/each}
		</div>

		{#if points.length === 0}
			<p class="status-text">
				{#if map.pending}
					mapping the library...
				{:else if map.failed}
					couldn't map the library
				{:else}
					nothing on the map yet
				{/if}
			</p>
		{:else if regions.length === 0}
			<p class="status-text">too few items on the map to find regions yet</p>
		{:else}
			<section>
				<h2>regions</h2>
				<p class="meta">the aesthetics you keep coming back to</p>
				<div class="regions">
					{#each regions as region (region.id)}
						{@const more = moreStyles(region)}
						<a href="/atlas?region={region.id}" class="clickable set-card">
							<div class="region-head">
								<div class="region-title">
									<span>{region.name}</span>
									{#if more.length > 0}
										<span class="meta">{more.join(' · ')}</span>
									{/if}
								</div>
								<span class="meta">{region.itemIds.length}</span>
							</div>
							<div class="mosaic">
								{#each typical(region, 6) as item (item._id)}
									<div>{@render thumb(item)}</div>
								{/each}
							</div>
						</a>
					{/each}
				</div>
			</section>

			{#if shift && (rising.length > 0 || falling.length > 0)}
				<section>
					<h2>lately</h2>
					<p class="meta">
						your last {shift.count} saves on the map, since {shortDate(shift.since)}, against
						everything before
					</p>
					<div class="shifts">
						{#each rising as s (s.region.id)}
							{@render shiftRow(s, shift.recentIds, false)}
						{/each}
						{#each falling as s (s.region.id)}
							{@render shiftRow(s, shift.recentIds, true)}
						{/each}
					</div>
				</section>
			{/if}
		{/if}

		{#if graph.styles.length > 2}
			<section>
				<h2>styles</h2>
				<p class="meta">styles pull together when they share an item</p>
				<StyleConstellation styles={graph.styles} pairs={graph.pairs} />
			</section>
		{/if}

		{#if fonts.length > 0}
			<section>
				<h2>typefaces</h2>
				<ul class="fonts">
					{#each fonts as font (font.query)}
						{@const sites = lookup(font.itemIds)}
						{@const more = sites.length - FONT_SITES}
						{@const onAtlas =
							sites.length === 1
								? `/atlas?focus=${sites[0]._id}`
								: `/atlas?font=${encodeURIComponent(font.query)}`}
						<li class="font">
							<a class="font-name" href={onAtlas}>{font.name}</a>
							<span class="meta">{sites.length}</span>
							<div class="font-sites">
								{#each sites.slice(0, FONT_SITES) as item (item._id)}
									{@render thumbLink(item)}
								{/each}
								{#if more > 0}
									<a class="more" href={onAtlas}>+{more}</a>
								{/if}
							</div>
						</li>
					{/each}
				</ul>

				{#if pairings.length > 0}
					<div class="pairings">
						<span class="meta">set together on the same site</span>
						{#each pairings as pair (`${pair.a}\u0000${pair.b}`)}
							<span class="pair">{pair.a} + {pair.b} <span class="meta">{pair.count}</span></span>
						{/each}
					</div>
				{/if}
			</section>
		{/if}
	{/if}
</div>

{#snippet shiftRow(s: Shift, recentIds: Set<ItemId>, quiet: boolean)}
	<div class={['shift', { quiet }]}>
		<div class="shift-info">
			<a href="/atlas?region={s.region.id}" class="shift-name">{s.region.name}</a>
			<div class="compare">
				<span class="bar recent"><span style:width={percent(s.share)}></span></span>
				<span class="bar"><span style:width={percent(s.before)}></span></span>
			</div>
			<span class="meta">{percent(s.share)} of recent · {percent(s.before)} before</span>
		</div>
		<div class="thumbs">
			{#each recentIn(s, recentIds) as item (item._id)}
				{@render thumbLink(item)}
			{/each}
		</div>
	</div>
{/snippet}

<style>
	section {
		display: flex;
		flex-direction: column;
		gap: var(--space-lg);
		min-width: 0;
	}

	section > .meta {
		margin-top: calc(-1 * var(--space-md));
	}

	img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
		background: var(--bg-2);
	}

	.chip {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		height: 100%;
		padding: var(--space-xs);
		border: 1px solid var(--border);
		font-size: var(--text-xs);
		color: var(--txt-3);
		text-align: center;
		overflow: hidden;
		overflow-wrap: anywhere;
	}

	.thumbs {
		display: flex;
		flex-wrap: wrap;
		gap: var(--gap);
	}

	.thumb-link {
		display: block;
		width: 4rem;
		aspect-ratio: 4 / 3;
		overflow: hidden;

		&:hover {
			opacity: 0.8;
		}

		&:focus-visible {
			outline: 1px solid var(--txt-3);
			outline-offset: 1px;
		}
	}

	/* Stats */

	.stats {
		display: grid;
		grid-template-columns: repeat(5, 1fr);
		gap: var(--gutter);
	}

	.stat {
		display: flex;
		flex-direction: column;
		border: 1px solid var(--border);
		background: var(--bg-2);
		padding: var(--space-lg) var(--space-xl);
	}

	.stat-value {
		font-size: var(--text-3xl);
		font-weight: 500;
		letter-spacing: -0.02ch;
		color: var(--txt-1);
		line-height: 1.2;
		font-variant-numeric: tabular-nums;
	}

	.stat-label {
		font-size: var(--text-sm);
		color: var(--txt-3);
	}

	/* Regions */

	.regions {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr));
		gap: var(--gutter);
	}

	.region-head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: var(--gap);
	}

	.region-title {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.region-title .meta {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* Lately */

	.shifts {
		display: flex;
		flex-direction: column;
	}

	.shift {
		display: grid;
		grid-template-columns: 16rem 1fr;
		gap: var(--gutter);
		align-items: center;
		padding-block: var(--space-md);
		border-top: 1px solid var(--border);

		&:last-child {
			border-bottom: 1px solid var(--border);
		}
	}

	.shift.quiet {
		opacity: 0.6;
	}

	.shift-info {
		display: flex;
		flex-direction: column;
		gap: var(--gap-sm);
		min-width: 0;
	}

	.shift-name,
	.font-name {
		text-decoration: none;

		&:hover {
			color: var(--txt-1);
		}
	}

	.compare {
		display: flex;
		flex-direction: column;
		gap: var(--space-2xs);
		margin-block: var(--space-2xs);
	}

	.bar {
		display: block;
		height: 3px;
		background: var(--bg-3);
	}

	.bar > span {
		display: block;
		height: 100%;
		background: var(--txt-3);
	}

	.compare .bar.recent > span {
		background: var(--txt-2);
	}

	/* Typefaces: a row per font, most used first, reading down each column */

	.fonts {
		columns: 2 18rem;
		column-gap: calc(var(--gutter) * 2);
		list-style: none;
	}

	.font {
		display: flex;
		align-items: center;
		gap: var(--gap);
		padding-block: var(--space-xs);
		break-inside: avoid;
	}

	.font-name {
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	.font-sites {
		display: flex;
		gap: var(--gap-sm);
		flex-shrink: 0;
		margin-left: auto;

		& .thumb-link,
		& .more {
			width: 2rem;
			aspect-ratio: 1;
		}
	}

	/* The sites past the ones shown, as an empty thumbnail that opens the atlas */
	.more {
		display: flex;
		align-items: center;
		justify-content: center;
		border: 1px solid var(--border);
		font-size: var(--text-xs);
		color: var(--txt-3);
		text-decoration: none;

		&:hover {
			border-color: var(--txt-3);
			color: var(--txt-1);
		}

		&:focus-visible {
			outline: 1px solid var(--txt-3);
			outline-offset: 1px;
		}
	}

	.pairings {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--space-sm) var(--gap);
	}

	.pair {
		padding: var(--pad-y-xs) var(--pad-x-xs);
		font-size: var(--text-sm);
		background: var(--bg-2);
		border: 1px solid var(--border);
	}

	@media (max-width: 768px) {
		.page-header {
			flex-direction: column;
			align-items: flex-start;
			gap: var(--gap-sm);
		}

		.stats {
			grid-template-columns: repeat(2, 1fr);
		}

		/* five tiles: the first takes a row to itself */
		.stat:first-child {
			grid-column: span 2;
		}

		.regions {
			grid-template-columns: 1fr;
		}

		.shift {
			grid-template-columns: 1fr;
			gap: var(--gap);
		}
	}
</style>
