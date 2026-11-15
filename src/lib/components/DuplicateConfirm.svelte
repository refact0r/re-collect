<script lang="ts">
	import type { FunctionReturnType } from 'convex/server';
	import type { api } from '../../convex/_generated/api.js';
	import type { Id } from '../../convex/_generated/dataModel.js';
	import { getCollectionsContext } from '#lib/context.js';
	import { getItemUrl } from '#lib/itemDisplay.js';
	import Modal from './Modal.svelte';

	interface Props {
		// The saved copies, newest first (items.findByUrl)
		matches: FunctionReturnType<typeof api.items.findByUrl>;
		// The collection the add goes to, if any
		collectionId?: Id<'collections'>;
		onAdd: () => void;
		onCancel: () => void;
		// Following the link to the saved item, which also drops the add
		onView: () => void;
	}

	let { matches, collectionId, onAdd, onCancel, onView }: Props = $props();

	const collections = getCollectionsContext();
	const latest = $derived(matches[0]);

	const where = $derived.by(() => {
		if (collectionId && latest.collections.includes(collectionId)) return 'in this collection';
		const names = latest.collections
			.map((id) => collections.data?.find((c) => c._id === id)?.name)
			.filter(Boolean);
		return names.length ? `in ${names.join(', ')}` : 'uncollected';
	});

	const summary = $derived.by(() => {
		const added = new Date(latest.dateAdded).toLocaleDateString(undefined, {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		});
		const times = matches.length > 1 ? ` · saved ${matches.length} times` : '';
		return `added ${added}, ${where}${times}`;
	});
</script>

<Modal onClose={onCancel} size="narrow" labelledby="duplicate-title">
	<h2 id="duplicate-title">already saved</h2>
	<p>
		<a href={getItemUrl(latest._id)} onclick={onView}>{latest.title || latest.url}</a>
	</p>
	<p class="meta">{summary}</p>
	<div class="actions">
		<button onclick={onCancel}>cancel</button>
		<!-- svelte-ignore a11y_autofocus -->
		<button onclick={onAdd} autofocus>add anyway</button>
	</div>
</Modal>

<style>
	h2 {
		margin: 0 0 var(--space-lg) 0;
	}

	a {
		overflow-wrap: anywhere;
	}

	.actions {
		display: flex;
		gap: var(--gap);
		margin-top: var(--space-xl);
	}

	.actions button {
		flex: 1;
	}
</style>
