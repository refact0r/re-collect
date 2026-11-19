<script lang="ts">
	import type { Id } from '../../convex/_generated/dataModel.js';
	import { sortLibrary } from '../../convex/lib/sortItems.js';
	import ItemsView from '#lib/components/ItemsView.svelte';
	import TopControls from '#lib/components/TopControls.svelte';
	import { getCollectionsContext, getItemsContext, type QueryState } from '#lib/context.js';
	import type { DisplayItem } from '#lib/types.js';
	import { useViewPrefs } from '#lib/prefs.svelte.js';
	import { UNCOLLECTED } from '#lib/atlas.js';

	const collections = getCollectionsContext();
	const library = getItemsContext();
	const prefs = useViewPrefs('home');

	// Strings and a flag rather than the docs, so neither other pref writes nor
	// collection count updates redo the filter
	const savedIds = $derived(prefs.saved?.filterCollectionIds?.join() ?? '');
	const includeUncollected = $derived(prefs.saved?.includeUncollected ?? false);
	const existingIds = $derived(collections.data?.map((c) => c._id).join());

	// The picked collections that still exist, and uncollected items if picked;
	// picking none shows everything
	const filter = $derived.by(() => {
		const existing = existingIds?.split(',');
		const ids = savedIds.split(',').filter((id) => id && (existing?.includes(id) ?? true));
		if (ids.length === 0 && !includeUncollected) return null;
		return { collectionIds: ids as Id<'collections'>[], includeUncollected };
	});

	const selected = $derived(
		new Set<string>(
			filter ? [...filter.collectionIds, ...(filter.includeUncollected ? [UNCOLLECTED] : [])] : []
		)
	);

	function setFilter(next: Set<string>) {
		prefs.set({
			filterCollectionIds: [...next].filter((id) => id !== UNCOLLECTED) as Id<'collections'>[],
			includeUncollected: next.has(UNCOLLECTED)
		});
	}

	// The layout's library, sorted and filtered here. Saved prefs pick the sort
	// and filter, so nothing shows until they load.
	const shown = $derived.by(() => {
		if (!prefs.loaded || !library.data) return undefined;
		const sorted = sortLibrary(library.data, prefs.sortBy);
		if (!filter) return sorted;
		const picked = new Set<string>(filter.collectionIds);
		return sorted.filter((item) =>
			item.collections.length > 0
				? item.collections.some((c) => picked.has(c))
				: filter.includeUncollected
		);
	});
	const items: QueryState<DisplayItem[]> = {
		get data() {
			return shown;
		},
		get error() {
			return prefs.loaded ? library.error : undefined;
		},
		get isLoading() {
			return prefs.loaded && library.isLoading;
		}
	};
</script>

<TopControls
	{prefs}
	collections={collections.data ?? []}
	filterCollectionIds={selected}
	onFilterChange={setFilter}
	filterCount={items.data?.length}
/>
<ItemsView
	{items}
	{prefs}
	empty={filter ? 'nothing in the picked collections' : 'no items yet. add your first one above!'}
/>
