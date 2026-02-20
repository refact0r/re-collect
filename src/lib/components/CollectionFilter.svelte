<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import type { Id } from '../../convex/_generated/dataModel.js';
	import IconFilterList from '~icons/material-symbols-light/filter-list';
	import Dropdown from './Dropdown.svelte';

	interface Collection {
		_id: Id<'collections'>;
		name: string;
	}

	interface Props {
		collections: Collection[];
		selected: Set<Id<'collections'>>;
		onchange: (selected: Set<Id<'collections'>>) => void;
	}

	let { collections, selected, onchange }: Props = $props();

	const label = $derived(
		selected.size === collections.length || selected.size === 0 ? 'all' : String(selected.size)
	);

	function toggle(id: Id<'collections'>) {
		const next = new SvelteSet(selected);
		if (next.has(id)) {
			next.delete(id);
		} else {
			next.add(id);
		}
		onchange(next);
	}
</script>

<Dropdown {label}>
	{#snippet icon()}
		<IconFilterList />
	{/snippet}
	{#snippet content()}
		{#each collections as col (col._id)}
			<label class="option">
				<input type="checkbox" checked={selected.has(col._id)} onchange={() => toggle(col._id)} />
				{col.name}
			</label>
		{/each}
		{#if collections.length === 0}
			<span class="empty">no collections</span>
		{/if}
	{/snippet}
</Dropdown>

<style>
	.option {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem;
		cursor: pointer;
		white-space: nowrap;
	}

	.option:hover {
		background: var(--bg-3);
		color: var(--txt-1);
	}

	.option input[type='checkbox'] {
		accent-color: var(--txt-2);
		cursor: pointer;
	}

	.option:hover input[type='checkbox'] {
		accent-color: var(--txt-1);
	}

	.empty {
		padding: 0.5rem;
		color: var(--txt-3);
	}
</style>
