<script lang="ts">
	import ItemInput from './ItemInput.svelte';
	import IngestSettings from './IngestSettings.svelte';
	import ViewToggle, { type ViewMode } from './ViewToggle.svelte';
	import CollectionFilter from './CollectionFilter.svelte';
	import SortDropdown from './SortDropdown.svelte';
	import type { Id } from '../../convex/_generated/dataModel.js';

	type SortOption =
		| 'manual'
		| 'dateAddedNewest'
		| 'dateAddedOldest'
		| 'dateModifiedNewest'
		| 'dateModifiedOldest'
		| 'titleAsc'
		| 'titleDesc';

	interface Props {
		collectionId?: Id<'collections'>;
		sortBy: SortOption;
		viewMode: ViewMode;
		showManualSort?: boolean;
		onSortChange: (sort: SortOption) => void;
		onViewModeChange: (mode: ViewMode) => void;
		collections?: { _id: Id<'collections'>; name: string }[];
		filterCollectionIds?: Set<string>;
		onFilterChange?: (selected: Set<string>) => void;
	}

	let {
		collectionId,
		sortBy,
		viewMode,
		showManualSort = false,
		onSortChange,
		onViewModeChange,
		collections,
		filterCollectionIds,
		onFilterChange
	}: Props = $props();
</script>

<div class="top-row">
	<div class="input-wrapper">
		<ItemInput {collectionId} />
	</div>
	<div class="controls">
		{#if collections && filterCollectionIds && onFilterChange}
			<CollectionFilter {collections} selected={filterCollectionIds} onchange={onFilterChange} />
		{/if}
		<SortDropdown value={sortBy} {showManualSort} onchange={onSortChange} />
		<ViewToggle value={viewMode} onchange={onViewModeChange} />
	</div>
	<div class="settings-slot">
		<IngestSettings {collectionId} />
	</div>
</div>

<style>
	.top-row {
		display: flex;
		gap: 0.5rem;
		margin-bottom: var(--spacing);
		align-items: flex-start;
	}

	.input-wrapper {
		flex: 1;
	}

	.controls {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}

	.settings-slot {
		flex-shrink: 0;
	}

	@media (max-width: 768px) {
		.top-row {
			flex-wrap: wrap;
		}

		.input-wrapper {
			flex: 1 1 100%;
		}

		/* Second row: controls on the left, settings at the far right */
		.controls {
			flex: 1 1 auto;
		}

		.settings-slot {
			margin-left: auto;
		}
	}
</style>
