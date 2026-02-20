<script lang="ts">
	import IconSort from '~icons/material-symbols-light/sort';
	import Dropdown from './Dropdown.svelte';

	type SortOption =
		| 'manual'
		| 'dateAddedNewest'
		| 'dateAddedOldest'
		| 'dateModifiedNewest'
		| 'dateModifiedOldest'
		| 'titleAsc'
		| 'titleDesc';

	interface Props {
		value: SortOption;
		showManualSort?: boolean;
		onchange: (sort: SortOption) => void;
	}

	let { value, showManualSort = false, onchange }: Props = $props();

	const options: { value: SortOption; label: string; manual?: boolean }[] = [
		{ value: 'manual', label: 'manual', manual: true },
		{ value: 'dateAddedNewest', label: 'added (new)' },
		{ value: 'dateAddedOldest', label: 'added (old)' },
		{ value: 'dateModifiedNewest', label: 'modified (new)' },
		{ value: 'dateModifiedOldest', label: 'modified (old)' },
		{ value: 'titleAsc', label: 'title (a-z)' },
		{ value: 'titleDesc', label: 'title (z-a)' }
	];

	const visibleOptions = $derived(showManualSort ? options : options.filter((o) => !o.manual));

	const label = $derived(visibleOptions.find((o) => o.value === value)?.label ?? value);
</script>

<Dropdown {label}>
	{#snippet icon()}
		<IconSort />
	{/snippet}
	{#snippet content(close)}
		{#each visibleOptions as opt (opt.value)}
			<button
				class="option"
				class:active={value === opt.value}
				onclick={() => {
					onchange(opt.value);
					close();
				}}
			>
				{opt.label}
			</button>
		{/each}
	{/snippet}
</Dropdown>

<style>
	.option {
		width: 100%;
		text-align: left;
		border: none;
		background: transparent;
		padding: 0.5rem;
		white-space: nowrap;
		justify-content: flex-start;
	}

	.option:hover {
		background: var(--bg-3);
	}

	.option.active {
		color: var(--txt-1);
		background: var(--bg-3);
	}
</style>
