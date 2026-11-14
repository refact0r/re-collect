<script lang="ts">
	import ItemInput from './ItemInput.svelte';
	import SettingsMenu from './SettingsMenu.svelte';
	import ViewToggle from './ViewToggle.svelte';
	import ColumnControl from './ColumnControl.svelte';
	import CollectionFilter from './CollectionFilter.svelte';
	import SortDropdown from './SortDropdown.svelte';
	import type { Id } from '../../convex/_generated/dataModel.js';
	import type { ViewPrefs } from '#lib/prefs.svelte.js';

	interface Props {
		// A collection page: adds go into it and manual sort is offered
		collectionId?: Id<'collections'>;
		prefs: ViewPrefs;
		collections?: { _id: Id<'collections'>; name: string }[];
		filterCollectionIds?: Set<string>;
		onFilterChange?: (selected: Set<string>) => void;
	}

	let { collectionId, prefs, collections, filterCollectionIds, onFilterChange }: Props = $props();
</script>

<div class="top-row">
	<div class="input-wrapper">
		<ItemInput {collectionId} />
	</div>
	<div class="controls">
		{#if collections && filterCollectionIds && onFilterChange}
			<CollectionFilter {collections} selected={filterCollectionIds} onchange={onFilterChange} />
		{/if}
		<SortDropdown
			value={prefs.sortBy}
			showManualSort={!!collectionId}
			onchange={(sortMode) => prefs.set({ sortMode })}
		/>
		{#if prefs.viewMode === 'grid'}
			<ColumnControl
				value={prefs.columnOffset}
				onchange={(columnOffset) => prefs.set({ columnOffset })}
			/>
		{/if}
		<ViewToggle value={prefs.viewMode} onchange={(viewMode) => prefs.set({ viewMode })} />
	</div>
	<div class="settings-slot">
		<SettingsMenu
			{collectionId}
			showTitles={prefs.showTitles}
			onShowTitlesChange={(showTitles) => prefs.set({ showTitles })}
		/>
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
