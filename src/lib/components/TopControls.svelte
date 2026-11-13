<script lang="ts">
	import ItemInput from './ItemInput.svelte';
	import SettingsMenu from './SettingsMenu.svelte';
	import ViewToggle, { type ViewMode } from './ViewToggle.svelte';
	import ColumnControl from './ColumnControl.svelte';
	import CollectionFilter from './CollectionFilter.svelte';
	import SortDropdown from './SortDropdown.svelte';
	import type { Id } from '../../convex/_generated/dataModel.js';
	import type { CollectionSortOption } from '#lib/types.js';
	import IconSearch from '~icons/material-symbols-light/search';

	interface Props {
		collectionId?: Id<'collections'>;
		sortBy: CollectionSortOption;
		viewMode: ViewMode;
		columnOffset: number;
		showTitles: boolean;
		showManualSort?: boolean;
		onSortChange: (sort: CollectionSortOption) => void;
		onViewModeChange: (mode: ViewMode) => void;
		onColumnOffsetChange: (offset: number) => void;
		onShowTitlesChange: (show: boolean) => void;
		collections?: { _id: Id<'collections'>; name: string }[];
		filterCollectionIds?: Set<string>;
		onFilterChange?: (selected: Set<string>) => void;
		// Someone else's collection: a search box in place of the add bar, and only
		// the view settings in the menu
		readonly?: boolean;
		query?: string;
		onQueryChange?: (query: string) => void;
	}

	let {
		collectionId,
		sortBy,
		viewMode,
		columnOffset,
		showTitles,
		showManualSort = false,
		onSortChange,
		onViewModeChange,
		onColumnOffsetChange,
		onShowTitlesChange,
		collections,
		filterCollectionIds,
		onFilterChange,
		readonly = false,
		query = '',
		onQueryChange
	}: Props = $props();
</script>

<div class="top-row">
	<div class="input-wrapper">
		{#if readonly}
			<label class="search">
				<IconSearch />
				<input
					type="search"
					value={query}
					oninput={(e) => onQueryChange?.(e.currentTarget.value)}
					placeholder="search this collection..."
				/>
			</label>
		{:else}
			<ItemInput {collectionId} />
		{/if}
	</div>
	<div class="controls">
		{#if collections && filterCollectionIds && onFilterChange}
			<CollectionFilter {collections} selected={filterCollectionIds} onchange={onFilterChange} />
		{/if}
		<SortDropdown value={sortBy} {showManualSort} onchange={onSortChange} />
		{#if viewMode === 'grid'}
			<ColumnControl value={columnOffset} onchange={onColumnOffsetChange} />
		{/if}
		<ViewToggle value={viewMode} onchange={onViewModeChange} />
	</div>
	<div class="settings-slot">
		{#if readonly}
			<SettingsMenu showIngestion={false} {showTitles} {onShowTitlesChange} />
		{:else}
			<SettingsMenu {collectionId} {showTitles} {onShowTitlesChange} />
		{/if}
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

	.search {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding-left: 0.5rem;
		border: 1px solid var(--border);
		background: var(--bg-2);
		cursor: text;
	}

	.search:focus-within {
		border-color: var(--txt-3);
	}

	.search :global(svg) {
		width: 1.5rem;
		height: 1.5rem;
		flex-shrink: 0;
	}

	.search input {
		flex: 1;
		min-width: 0;
		min-height: 2.5rem;
		border: none;
		background: transparent;
		outline: none;
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
