<script lang="ts">
	import { useConvexClient } from 'convex-svelte';
	import { api } from '../../convex/_generated/api.js';
	import { mutate } from '$lib/mutationHelper.js';
	import { getWriteTokenContext } from '$lib/context.js';
	import type { CollectionSortOption } from '$lib/types.js';

	interface Props {
		onClose: () => void;
	}

	let { onClose }: Props = $props();

	const client = useConvexClient();
	const getWriteToken = getWriteTokenContext();
	const writeToken = $derived(getWriteToken());

	let name = $state('');
	let isCreating = $state(false);

	// undefined on the doc means the default; only send values that differ
	let sortMode = $state<CollectionSortOption>('manual');
	let viewMode = $state<'grid' | 'list'>('grid');
	let taggingMode = $state<'visual' | 'text' | 'none'>('visual');
	let linkImageMode = $state<'screenshot' | 'og'>('screenshot');

	const sortOptions: { value: CollectionSortOption; label: string }[] = [
		{ value: 'manual', label: 'manual' },
		{ value: 'dateAddedNewest', label: 'added (new)' },
		{ value: 'dateAddedOldest', label: 'added (old)' },
		{ value: 'dateModifiedNewest', label: 'modified (new)' },
		{ value: 'dateModifiedOldest', label: 'modified (old)' },
		{ value: 'titleAsc', label: 'title (a-z)' },
		{ value: 'titleDesc', label: 'title (z-a)' }
	];
	const viewOptions = [
		{ value: 'grid', label: 'grid' },
		{ value: 'list', label: 'list' }
	] as const;
	const taggingOptions = [
		{ value: 'visual', label: 'visual' },
		{ value: 'text', label: 'text' },
		{ value: 'none', label: 'none' }
	] as const;
	const linkImageOptions = [
		{ value: 'screenshot', label: 'screenshot' },
		{ value: 'og', label: 'og image' }
	] as const;

	async function handleCreate() {
		if (!name.trim()) return;

		isCreating = true;
		try {
			const result = await mutate(writeToken, (token) =>
				client.mutation(api.collections.create, {
					name: name.trim(),
					sortMode: sortMode === 'manual' ? undefined : sortMode,
					viewMode: viewMode === 'grid' ? undefined : viewMode,
					taggingMode: taggingMode === 'visual' ? undefined : taggingMode,
					linkImageMode: linkImageMode === 'screenshot' ? undefined : linkImageMode,
					token
				})
			);
			if (result !== null) {
				onClose();
			}
		} finally {
			isCreating = false;
		}
	}

	function handleBackdropClick(event: MouseEvent) {
		if (event.target === event.currentTarget) {
			onClose();
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			onClose();
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="backdrop" onclick={handleBackdropClick} role="dialog" aria-modal="true" tabindex="-1">
	<div class="modal">
		<h2>new collection</h2>
		<div class="form">
			<input type="text" bind:value={name} placeholder="collection name" disabled={isCreating} />
			<div class="group">
				<span class="group-label">sort</span>
				<select bind:value={sortMode} disabled={isCreating}>
					{#each sortOptions as opt (opt.value)}
						<option value={opt.value}>{opt.label}</option>
					{/each}
				</select>
			</div>
			<div class="group">
				<span class="group-label">view</span>
				<div class="mode-options">
					{#each viewOptions as opt (opt.value)}
						<button
							class:active={viewMode === opt.value}
							onclick={() => (viewMode = opt.value)}
							disabled={isCreating}
						>
							{opt.label}
						</button>
					{/each}
				</div>
			</div>
			<div class="group">
				<span class="group-label">ai tagging</span>
				<div class="mode-options">
					{#each taggingOptions as opt (opt.value)}
						<button
							class:active={taggingMode === opt.value}
							onclick={() => (taggingMode = opt.value)}
							disabled={isCreating}
						>
							{opt.label}
						</button>
					{/each}
				</div>
			</div>
			<div class="group">
				<span class="group-label">link image</span>
				<div class="mode-options">
					{#each linkImageOptions as opt (opt.value)}
						<button
							class:active={linkImageMode === opt.value}
							onclick={() => (linkImageMode = opt.value)}
							disabled={isCreating}
						>
							{opt.label}
						</button>
					{/each}
				</div>
			</div>
			<div class="actions">
				<button onclick={onClose} disabled={isCreating}>cancel</button>
				<button onclick={handleCreate} disabled={isCreating || !name.trim()}>create</button>
			</div>
		</div>
	</div>
</div>

<style>
	h2 {
		margin: 0 0 1rem 0;
	}

	.form {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.group {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.group-label {
		font-size: 0.875rem;
		color: var(--txt-3);
	}

	.actions {
		display: flex;
		gap: 0.5rem;
		width: 100%;
		margin-top: 0.75rem;
	}

	.actions button {
		flex: 1;
	}
</style>
