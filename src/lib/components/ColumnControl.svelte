<script lang="ts">
	import IconRemove from '~icons/material-symbols-light/remove';
	import IconAdd from '~icons/material-symbols-light/add';

	// Offset from the width-derived column count; ItemGrid clamps the result
	const MAX_OFFSET = 5;

	interface Props {
		value: number;
		onchange: (offset: number) => void;
	}

	let { value, onchange }: Props = $props();
</script>

<div class="column-control">
	<button
		class="icon-filled"
		title="Fewer columns"
		disabled={value <= -MAX_OFFSET}
		onclick={() => onchange(value - 1)}
	>
		<IconRemove />
	</button>
	<button
		class="icon-filled"
		title="More columns"
		disabled={value >= MAX_OFFSET}
		onclick={() => onchange(value + 1)}
	>
		<IconAdd />
	</button>
</div>

<style>
	.column-control {
		display: flex;
	}

	.column-control button {
		border-radius: 0;
	}

	.column-control button:first-child {
		border-right: none;
	}
</style>
