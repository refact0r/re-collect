<script lang="ts">
	import { api } from '../../convex/_generated/api.js';
	import type { Id } from '../../convex/_generated/dataModel.js';
	import ItemsView from '#lib/components/ItemsView.svelte';
	import TopControls from '#lib/components/TopControls.svelte';
	import { useQuery } from '#lib/convex.js';
	import { getCollectionsContext } from '#lib/context.js';
	import { useViewPrefs } from '#lib/prefs.svelte.js';

	// The filter's "uncollected" option, next to collection ids
	const UNCOLLECTED = 'uncollected';

	const collections = getCollectionsContext();
	const prefs = useViewPrefs('home');

	// Strings and a flag rather than the docs, so neither other pref writes nor
	// collection count updates restart the items query
	const savedIds = $derived(prefs.saved?.filterCollectionIds?.join() ?? '');
	const includeUncollected = $derived(prefs.saved?.includeUncollected !== false);
	const existingIds = $derived(collections.data?.map((c) => c._id).join());

	// No saved filter means everything, so new collections show up; a saved one
	// counts only collections that still exist
	const filter = $derived.by(() => {
		if (!savedIds && includeUncollected) return null;
		const existing = existingIds?.split(',');
		const ids = savedIds.split(',').filter((id) => id && (existing?.includes(id) ?? true));
		return { collectionIds: ids as Id<'collections'>[], includeUncollected };
	});

	const selected = $derived(
		new Set<string>(
			filter
				? [...filter.collectionIds, ...(filter.includeUncollected ? [UNCOLLECTED] : [])]
				: [...(collections.data ?? []).map((c) => c._id), UNCOLLECTED]
		)
	);

	function setFilter(next: Set<string>) {
		const all = next.has(UNCOLLECTED) && (collections.data ?? []).every((c) => next.has(c._id));
		const collectionIds = [...next].filter((id) => id !== UNCOLLECTED) as Id<'collections'>[];
		prefs.set({
			filterCollectionIds: all ? [] : collectionIds,
			includeUncollected: next.has(UNCOLLECTED)
		});
	}

	// Saved prefs pick the sort and filter, so wait for them rather than fetch twice.
	// The previous list stays up while a new sort or filter loads.
	const items = useQuery(
		api.items.list,
		() => (prefs.loaded ? { sortBy: prefs.sortBy, ...filter } : 'skip'),
		{ keepPreviousData: true }
	);
</script>

<TopControls
	{prefs}
	collections={collections.data ?? []}
	filterCollectionIds={selected}
	onFilterChange={setFilter}
/>
<ItemsView {items} {prefs} empty="no items yet. add your first one above!" />
