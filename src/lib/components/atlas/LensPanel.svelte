<script lang="ts">
	import { api } from '../../../convex/_generated/api.js';
	import type { Id } from '../../../convex/_generated/dataModel.js';
	import {
		colorStrips,
		countStyles,
		itemLabel,
		monthsOf,
		noLenses,
		UNCOLLECTED,
		type Brush,
		type Lenses,
		type Swatch
	} from '#lib/atlas.js';
	import { useAction } from '#lib/convex.js';
	import type { DisplayItem } from '#lib/types.js';
	import RangeStrip from './RangeStrip.svelte';

	interface Props {
		items: DisplayItem[];
		collections: { _id: Id<'collections'>; name: string }[];
		lenses: Lenses;
		onchange: (lenses: Lenses) => void;
		lit: number;
		playing: boolean;
		onplay: () => void;
		onselect: () => void;
	}

	let { items, collections, lenses, onchange, lit, playing, onplay, onselect }: Props = $props();

	const SEMANTIC_HITS = 12;
	const FIND_DELAY = 300;

	const runAction = useAction();

	const emit = (patch: Partial<Lenses>) => onchange({ ...lenses, ...patch });

	const active = $derived(
		lenses.collections.size > 0 ||
			lenses.styles.size > 0 ||
			!!lenses.hue ||
			!!lenses.tone ||
			!!lenses.added ||
			!!lenses.found
	);

	/* find */

	let findText = $state('');
	// The query last sent up, so a change from outside can be told apart
	let sentQuery = '';
	let findTimer: ReturnType<typeof setTimeout> | undefined;
	let findRun = 0;

	$effect(() => {
		const query = lenses.found?.query ?? '';
		if (query === sentQuery) return;
		clearTimeout(findTimer);
		findRun++;
		sentQuery = query;
		findText = query;
	});

	function find(text: string) {
		clearTimeout(findTimer);
		const query = text.trim();
		const run = ++findRun;
		sentQuery = query;
		if (!query) {
			emit({ found: null });
			return;
		}
		const terms = query.toLowerCase().split(/\s+/);
		const keyword = items
			.filter((item) => {
				const haystack = (item.searchText || itemLabel(item)).toLowerCase();
				return terms.every((term) => haystack.includes(term));
			})
			.map((item) => item._id);
		emit({ found: { query, itemIds: new Set(keyword) } });

		runAction(api.embeddings.search, { query }, { onError: () => {} }).then((ids) => {
			if (run !== findRun || lenses.found?.query !== query || !ids) return;
			const onMap = new Set(items.map((item) => item._id));
			const nearest = ids.filter((id) => onMap.has(id)).slice(0, SEMANTIC_HITS);
			if (nearest.length === 0) return;
			emit({ found: { query, itemIds: new Set([...keyword, ...nearest]) } });
		});
	}

	function onFindInput() {
		clearTimeout(findTimer);
		findTimer = setTimeout(() => find(findText), FIND_DELAY);
	}

	function onFindKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') find(findText);
		else if (e.key === 'Escape' && findText) {
			findText = '';
			find('');
		}
	}

	$effect(() => () => clearTimeout(findTimer));

	/* collections */

	const collectionCounts = $derived.by(() => {
		const counts = new Map<string, number>();
		const add = (id: string) => counts.set(id, (counts.get(id) ?? 0) + 1);
		for (const item of items) {
			if (item.collections.length === 0) add(UNCOLLECTED);
			else for (const id of item.collections) add(id);
		}
		return counts;
	});

	// Only the collections with something on the map, since the rest light nothing
	const collectionRows = $derived(
		[
			...collections.map((c) => ({ id: c._id as string, name: c.name })),
			{ id: UNCOLLECTED, name: 'uncollected' }
		].filter((row) => collectionCounts.has(row.id) || lenses.collections.has(row.id))
	);

	function toggleIn<T>(set: Set<T>, value: T) {
		const next = new Set(set);
		if (!next.delete(value)) next.add(value);
		return next;
	}

	/* color */

	const strips = $derived(colorStrips(items));
	const colorStripRows = $derived(
		(['hue', 'tone'] as const)
			.map((lens) => ({ lens, swatches: strips[lens] }))
			.filter((row) => row.swatches.length > 0)
	);

	function brushColor(lens: 'hue' | 'tone', swatches: Swatch[], range: [number, number] | null) {
		const brush: Brush | null = range && {
			range,
			itemIds: new Set(swatches.slice(range[0], range[1] + 1).map((s) => s.itemId))
		};
		emit(lens === 'hue' ? { hue: brush } : { tone: brush });
	}

	/* styles */

	const styleCounts = $derived(countStyles(items));
	let styleFilter = $state('');
	// Checked styles first and always shown, the rest by count and narrowed by the filter
	const shownStyles = $derived.by(() => {
		const needle = styleFilter.trim().toLowerCase();
		const checked = styleCounts.filter((s) => lenses.styles.has(s.name));
		const rest = styleCounts.filter(
			(s) => !lenses.styles.has(s.name) && s.name.toLowerCase().includes(needle)
		);
		return [...checked, ...rest];
	});

	/* added */

	const months = $derived(monthsOf(items));
	const busiestMonth = $derived(Math.max(1, ...months.map((m) => m.count)));

	// The months the added range overlaps, which a time-lapse moves item by item
	const monthRange = $derived.by((): [number, number] | null => {
		const added = lenses.added;
		if (!added) return null;
		const first = months.findIndex((m) => m.end >= added[0]);
		const last = months.findLastIndex((m) => m.start <= added[1]);
		return first === -1 || last < first ? null : [first, last];
	});

	const addedText = $derived.by(() => {
		if (!monthRange) return 'all time';
		const [a, b] = monthRange;
		return a === b ? months[a].label : `${months[a].label} – ${months[b].label}`;
	});

	function brushMonths(range: [number, number] | null) {
		emit({ added: range && [months[range[0]].start, months[range[1]].end] });
	}
</script>

<div class="panel">
	<div class="top">
		<span class="count">
			{#if active}
				{lit} of {items.length}
			{:else}
				{items.length} items
			{/if}
		</span>
		{#if active}
			<button class="text-button" onclick={onselect}>select</button>
			<button class="text-button" onclick={() => onchange(noLenses())}>clear</button>
		{/if}
	</div>

	<section>
		<h3>find</h3>
		<input
			type="text"
			class="field"
			placeholder="find on the map..."
			aria-label="find on the map"
			bind:value={findText}
			oninput={onFindInput}
			onkeydown={onFindKeydown}
		/>
	</section>

	{#if colorStripRows.length > 0}
		<section>
			<h3>color</h3>
			<div class="color-strips">
				{#each colorStripRows as { lens, swatches } (lens)}
					<RangeStrip
						--strip-height="1.75rem"
						count={swatches.length}
						range={lenses[lens]?.range ?? null}
						onchange={(range) => brushColor(lens, swatches, range)}
						clickSpan={Math.round(swatches.length * 0.03)}
						label={lens === 'hue' ? 'hue' : 'light to dark'}
					>
						{#snippet cell(i)}
							<div class="swatch" style:background={swatches[i].hex}></div>
						{/snippet}
					</RangeStrip>
				{/each}
			</div>
		</section>
	{/if}

	{#if months.length >= 2}
		<section>
			<h3>added</h3>
			<RangeStrip
				--strip-height="3rem"
				count={months.length}
				range={monthRange}
				onchange={brushMonths}
				label="added"
				valuetext={addedText}
			>
				{#snippet cell(i, inRange)}
					<div
						class={['bar', { lit: inRange }]}
						style:height="{(months[i].count / busiestMonth) * 100}%"
						title="{months[i].label}: {months[i].count}"
					></div>
				{/snippet}
			</RangeStrip>
			<div class="added-line">
				<span>{addedText}</span>
				<button class="text-button" onclick={onplay}>{playing ? 'stop' : 'play'}</button>
			</div>
		</section>
	{/if}

	{#if collectionRows.length > 1}
		<section>
			<h3>collections</h3>
			<div class="rows collection-rows">
				{#each collectionRows as row (row.id)}
					{@const checked = lenses.collections.has(row.id)}
					<label class={['row', { on: checked }]}>
						<input
							type="checkbox"
							{checked}
							onchange={() => emit({ collections: toggleIn(lenses.collections, row.id) })}
						/>
						<span class="name">{row.name}</span>
						<span class="num">{collectionCounts.get(row.id) ?? 0}</span>
					</label>
				{/each}
			</div>
		</section>
	{/if}

	{#if styleCounts.length > 0}
		<section class="styles">
			<div class="styles-head">
				<h3>styles</h3>
				<input
					type="text"
					class="field"
					placeholder="filter styles..."
					aria-label="filter styles"
					bind:value={styleFilter}
					onkeydown={(e) => e.key === 'Escape' && (styleFilter = '')}
				/>
			</div>
			<div class="rows style-rows">
				{#each shownStyles as style (style.name)}
					{@const checked = lenses.styles.has(style.name)}
					<label class={['row', { on: checked }]}>
						<input
							type="checkbox"
							{checked}
							onchange={() => emit({ styles: toggleIn(lenses.styles, style.name) })}
						/>
						<span class="name">{style.name}</span>
						<span class="num">{style.count}</span>
					</label>
				{:else}
					<span class="empty">no styles match</span>
				{/each}
			</div>
		</section>
	{/if}
</div>

<style>
	.panel {
		height: 100%;
		min-height: 0;
		display: flex;
		flex-direction: column;
		overflow-y: auto;
		font-size: 0.8125rem;
	}

	.top {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.5rem 0.75rem;
	}

	.count {
		flex: 1;
		color: var(--txt-1);
		font-variant-numeric: tabular-nums;
	}

	section {
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		padding: 0.5rem 0.75rem 0.75rem;
		border-top: 1px solid var(--border);
	}

	/* Takes the height the rest leave, scrolling its own list; the panel only
	   scrolls once that's down to its minimum */
	section.styles {
		flex: 1 0 0;
		min-height: 8rem;
		padding-bottom: 0;
	}

	h3 {
		font-size: 0.75rem;
		font-weight: var(--font-weight);
		letter-spacing: normal;
		color: var(--txt-3);
	}

	.text-button {
		padding: 0;
		border: none;
		background: transparent;
		font-size: 0.8125rem;
		color: var(--txt-3);
	}

	.text-button:hover {
		background: transparent;
		color: var(--txt-1);
	}

	.field {
		width: 100%;
		min-width: 0;
		padding: 0.25rem 0.5rem;
		font-size: 0.8125rem;
	}

	.styles-head {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.styles-head .field {
		flex: 1;
		padding-block: 0.125rem;
	}

	.rows {
		display: flex;
		flex-direction: column;
		margin-inline: -0.375rem;
	}

	.collection-rows {
		max-height: 8.5rem;
		overflow-y: auto;
	}

	.style-rows {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding-bottom: 0.75rem;
	}

	.color-strips {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.swatch {
		width: 100%;
		height: 100%;
	}

	.row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.125rem 0.375rem;
		cursor: pointer;
	}

	.row:hover,
	.row.on {
		color: var(--txt-1);
	}

	.row:hover {
		background: var(--bg-2);
	}

	.name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.num {
		color: var(--txt-3);
		font-variant-numeric: tabular-nums;
	}

	.empty {
		padding: 0.125rem 0.375rem;
		color: var(--txt-3);
	}

	.bar {
		width: calc(100% - 1px);
		min-height: 1px;
		background: var(--txt-3);
	}

	.bar.lit {
		background: var(--txt-2);
	}

	.added-line {
		display: flex;
		justify-content: space-between;
		color: var(--txt-2);
	}
</style>
