<script lang="ts">
	import ItemInput from './ItemInput.svelte';
	import ViewToggle, { type ViewMode } from './ViewToggle.svelte';
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
	}

	let { collectionId, sortBy, viewMode, showManualSort = false, onSortChange, onViewModeChange }: Props = $props();
</script>

<div class="top-row">
	<div class="input-wrapper">
		<ItemInput {collectionId} />
	</div>
	<div class="controls">
		<select value={sortBy} onchange={(e) => onSortChange(e.currentTarget.value as SortOption)}>
			{#if showManualSort}
				<option value="manual">manual</option>
			{/if}
			<option value="dateAddedNewest">added (new)</option>
			<option value="dateAddedOldest">added (old)</option>
			<option value="dateModifiedNewest">modified (new)</option>
			<option value="dateModifiedOldest">modified (old)</option>
			<option value="titleAsc">title (a-z)</option>
			<option value="titleDesc">title (z-a)</option>
		</select>
		<ViewToggle value={viewMode} onchange={onViewModeChange} />
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

	@media (max-width: 768px) {
		.top-row {
			flex-wrap: wrap;
		}

		.input-wrapper {
			flex: 1 1 100%;
		}

		.controls {
			flex: 1 1 100%;
		}

		.controls select {
			flex: 1;
		}
	}
</style>
