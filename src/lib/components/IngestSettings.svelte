<script lang="ts">
	import { useConvexClient, useQuery } from 'convex-svelte';
	import { api } from '../../convex/_generated/api.js';
	import type { Doc, Id } from '../../convex/_generated/dataModel.js';
	import { mutate } from '$lib/mutationHelper.js';
	import { getCollectionsContext, getWriteTokenContext } from '$lib/context.js';
	import Dropdown from './Dropdown.svelte';
	import IconSettings from '~icons/material-symbols-light/settings-outline';

	interface Props {
		// Without a collection, settings apply to collection-less adds (home defaults)
		collectionId?: Id<'collections'>;
	}

	let { collectionId }: Props = $props();

	const client = useConvexClient();
	const collections = getCollectionsContext();
	const getWriteToken = getWriteTokenContext();
	const writeToken = $derived(getWriteToken());

	const homePrefs = useQuery(api.viewPreferences.get, () => ({ key: 'home' }));

	const source = $derived(
		collectionId
			? ((collections.data ?? []).find((c: Doc<'collections'>) => c._id === collectionId) ?? null)
			: homePrefs.data
	);
	const taggingMode = $derived(source?.taggingMode ?? 'visual');
	const linkImageMode = $derived(source?.linkImageMode ?? 'screenshot');

	const taggingOptions = [
		{ value: 'visual', label: 'visual' },
		{ value: 'none', label: 'none' }
	] as const;
	const linkImageOptions = [
		{ value: 'screenshot', label: 'screenshot' },
		{ value: 'og', label: 'og image' }
	] as const;

	async function setDefaults(fields: {
		taggingMode?: 'visual' | 'none';
		linkImageMode?: 'screenshot' | 'og';
	}) {
		await mutate(writeToken, (token) =>
			collectionId
				? client.mutation(api.collections.update, { id: collectionId, ...fields, token })
				: client.mutation(api.viewPreferences.set, { key: 'home', ...fields, token })
		);
	}
</script>

<div class="ingest-settings">
	<Dropdown label="">
		{#snippet icon()}
			<IconSettings />
		{/snippet}
		{#snippet content()}
			<div class="panel">
				<p class="hint">
					{collectionId ? 'defaults for new items' : 'defaults for uncollected items'}
				</p>
				<div class="group">
					<span class="group-label">ai tagging</span>
					<div class="mode-options">
						{#each taggingOptions as opt (opt.value)}
							<button
								class:active={taggingMode === opt.value}
								onclick={() => setDefaults({ taggingMode: opt.value })}
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
								onclick={() => setDefaults({ linkImageMode: opt.value })}
							>
								{opt.label}
							</button>
						{/each}
					</div>
				</div>
			</div>
		{/snippet}
	</Dropdown>
</div>

<style>
	/* Match the icon-filled buttons this sits next to in the controls row */
	.ingest-settings :global(.trigger) {
		aspect-ratio: 1;
		padding: 0.5rem;
	}

	.ingest-settings :global(.trigger svg) {
		width: 1.5rem;
		height: 1.5rem;
	}

	.panel {
		min-width: 16rem;
		padding: 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.hint {
		color: var(--txt-3);
		font-size: 0.875rem;
	}

	.group {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.group-label {
		font-size: 1rem;
	}
</style>
