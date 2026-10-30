<script lang="ts">
	import { useConvexClient, useQuery } from 'convex-svelte';
	import { api } from '../../convex/_generated/api.js';
	import type { Doc, Id } from '../../convex/_generated/dataModel.js';
	import { mutate } from '#lib/mutationHelper.js';
	import { getCollectionsContext, getWriteTokenContext } from '#lib/context.js';
	import Dropdown from './Dropdown.svelte';
	import IconSettings from '~icons/material-symbols-light/settings-outline';

	interface Props {
		// Without a collection, ingestion settings apply to collection-less adds (home defaults)
		collectionId?: Id<'collections'>;
		showIngestion?: boolean;
		showTitles: boolean;
		onShowTitlesChange: (show: boolean) => void;
	}

	let { collectionId, showIngestion = true, showTitles, onShowTitlesChange }: Props = $props();

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
		{ value: 'text', label: 'text' },
		{ value: 'none', label: 'none' }
	] as const;
	const titleOptions = [
		{ value: false, label: 'hidden' },
		{ value: true, label: 'shown' }
	] as const;
	const linkImageOptions = [
		{ value: 'screenshot', label: 'screenshot' },
		{ value: 'og', label: 'og image' }
	] as const;

	async function setDefaults(fields: {
		taggingMode?: 'visual' | 'text' | 'none';
		linkImageMode?: 'screenshot' | 'og';
	}) {
		await mutate(writeToken, (token) =>
			collectionId
				? client.mutation(api.collections.update, { id: collectionId, ...fields, token })
				: client.mutation(api.viewPreferences.set, { key: 'home', ...fields, token })
		);
	}
</script>

<div class="settings-menu">
	<Dropdown label="">
		{#snippet icon()}
			<IconSettings />
		{/snippet}
		{#snippet content()}
			<div class="panel">
				<div class="group">
					<span class="group-label">titles</span>
					<div class="mode-options">
						{#each titleOptions as opt (opt.value)}
							<button
								class:active={showTitles === opt.value}
								onclick={() => onShowTitlesChange(opt.value)}
							>
								{opt.label}
							</button>
						{/each}
					</div>
				</div>
				{#if showIngestion}
					<div class="group">
						<span class="group-label">ai tagging default</span>
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
						<span class="group-label">link image default</span>
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
				{/if}
			</div>
		{/snippet}
	</Dropdown>
</div>

<style>
	/* Match the icon-filled buttons this sits next to in the controls row */
	.settings-menu :global(.trigger) {
		aspect-ratio: 1;
		padding: 0.5rem;
	}

	/* The default dropdown height cap is for long lists; this panel is short and fixed */
	.settings-menu :global(.dropdown) {
		max-height: none;
	}

	.settings-menu :global(.trigger svg) {
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

	.group {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.group-label {
		font-size: 1rem;
	}
</style>
