<script lang="ts">
	import IconTune from '~icons/material-symbols-light/tune';
	import Dropdown from './Dropdown.svelte';

	interface Source {
		key: string;
		name: string;
		group: string | null;
		hidden: boolean;
	}

	interface Props {
		sources: Source[];
		onchange: (key: string, hidden: boolean) => void;
	}

	let { sources, onchange }: Props = $props();

	const on = $derived(sources.filter((s) => !s.hidden).length);
	const label = $derived(on === sources.length ? 'all sources' : `${on} sources`);

	// Ungrouped sources first, then each group under its name
	const sections = $derived.by(() => {
		const map = new Map<string | null, Source[]>();
		for (const source of sources) map.set(source.group, [...(map.get(source.group) ?? []), source]);
		return [...map].sort(([a], [b]) => (a === null ? -1 : b === null ? 1 : 0));
	});
</script>

<Dropdown {label}>
	{#snippet icon()}
		<IconTune />
	{/snippet}
	{#snippet content()}
		{#each sections as [group, list] (group)}
			{#if group}<span class="group">{group}</span>{/if}
			{#each list as source (source.key)}
				<label class="option">
					<input
						type="checkbox"
						checked={!source.hidden}
						onchange={(e) => onchange(source.key, !e.currentTarget.checked)}
					/>
					{source.name}
				</label>
			{/each}
		{/each}
	{/snippet}
</Dropdown>

<style>
	.group {
		padding: 0.5rem 0.5rem 0.25rem;
		border-top: 1px solid var(--bg-3);
		font-size: 0.875rem;
		color: var(--txt-3);
	}

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
</style>
