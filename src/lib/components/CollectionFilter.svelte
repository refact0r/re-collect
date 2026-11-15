<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import type { Id } from '../../convex/_generated/dataModel.js';
	import IconFilter from '~icons/material-symbols-light/filter-alt-outline-sharp';
	import Dropdown from './Dropdown.svelte';

	const UNCOLLECTED = 'uncollected';

	interface Collection {
		_id: Id<'collections'>;
		name: string;
	}

	interface Props {
		collections: Collection[];
		selected: Set<string>;
		onchange: (selected: Set<string>) => void;
		// Items the filter leaves showing (undefined while they load)
		count: number | undefined;
	}

	let { collections, selected, onchange, count }: Props = $props();

	function toggle(id: string) {
		const next = new SvelteSet(selected);
		if (next.has(id)) {
			next.delete(id);
		} else {
			next.add(id);
		}
		onchange(next);
	}
</script>

<Dropdown label={count === undefined ? '' : String(count)} title="filter by collection">
	{#snippet icon()}
		<IconFilter />
	{/snippet}
	{#snippet content()}
		{#each collections as col (col._id)}
			<label class="option">
				<input type="checkbox" checked={selected.has(col._id)} onchange={() => toggle(col._id)} />
				{col.name}
			</label>
		{/each}
		<label class="option uncollected">
			<input
				type="checkbox"
				checked={selected.has(UNCOLLECTED)}
				onchange={() => toggle(UNCOLLECTED)}
			/>
			uncollected
		</label>
	{/snippet}
</Dropdown>

<style>
	.option {
		display: flex;
		align-items: center;
		gap: var(--gap);
		padding: var(--pad-y) var(--pad-x);
		cursor: pointer;
		white-space: nowrap;
	}

	.option:hover {
		background: var(--bg-3);
		color: var(--txt-1);
	}

	.uncollected {
		border-top: 1px solid var(--bg-3);
	}
</style>
