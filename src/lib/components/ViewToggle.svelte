<script lang="ts">
	import IconGrid from '~icons/material-symbols-light/grid-view-outline';
	import IconList from '~icons/material-symbols-light/view-list-outline';

	export type ViewMode = 'grid' | 'list';

	interface Props {
		value: ViewMode;
		onchange: (mode: ViewMode) => void;
	}

	let { value, onchange }: Props = $props();
</script>

<div class="view-toggle">
	<button
		class="icon-filled"
		class:active={value === 'grid'}
		title="Grid view"
		onclick={() => onchange('grid')}
	>
		<IconGrid />
	</button>
	<button
		class="icon-filled"
		class:active={value === 'list'}
		title="List view"
		onclick={() => onchange('list')}
	>
		<IconList />
	</button>
</div>

<style>
	.view-toggle {
		display: flex;
	}

	.view-toggle button {
		border-radius: 0;
	}

	.view-toggle button:first-child {
		border-right: none;
	}

	.view-toggle button.active {
		background: var(--bg-3);
		color: var(--txt-1);
	}
</style>
