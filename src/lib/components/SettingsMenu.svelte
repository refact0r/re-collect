<script lang="ts">
	import { TAGGING_MODE_LABEL, taggingModeOptions, type TaggingMode } from '#lib/taggingModes.js';
	import { api } from '../../convex/_generated/api.js';
	import type { Doc, Id } from '../../convex/_generated/dataModel.js';
	import { useMutation, useQuery } from '#lib/convex.js';
	import { getCollectionsContext } from '#lib/context.js';
	import Dropdown from './Dropdown.svelte';
	import IconSettings from '~icons/material-symbols-light/settings-outline-sharp';

	interface Props {
		// Without a collection, ingestion settings apply to collection-less adds (home
		// defaults). With one, the owner also gets its sharing setting.
		collectionId?: Id<'collections'>;
		showIngestion?: boolean;
		showTitles: boolean;
		onShowTitlesChange: (show: boolean) => void;
	}

	let { collectionId, showIngestion = true, showTitles, onShowTitlesChange }: Props = $props();

	const mutate = useMutation();
	const collections = getCollectionsContext();

	const homePrefs = useQuery(api.viewPreferences.get, () =>
		showIngestion && !collectionId ? { key: 'home' } : 'skip'
	);

	const collection = $derived(
		collectionId
			? (collections.data?.find((c: Doc<'collections'>) => c._id === collectionId) ?? null)
			: null
	);
	const source = $derived(collectionId ? collection : homePrefs.data);
	const taggingMode = $derived(source?.taggingMode ?? 'visual');
	const linkImageMode = $derived(source?.linkImageMode ?? 'screenshot');
	const shared = $derived(!!collection?.shared);

	const titleOptions = [
		{ value: false, label: 'hidden' },
		{ value: true, label: 'shown' }
	] as const;
	const linkImageOptions = [
		{ value: 'screenshot', label: 'screenshot' },
		{ value: 'og', label: 'og image' }
	] as const;

	function setShared(value: boolean) {
		if (!collectionId) return;
		return mutate(api.collections.update, { id: collectionId, shared: value });
	}

	// The link is the collection's own URL; copying it from a private collection
	// shares it first, so it never hands out a link that 404s. A blocked
	// clipboard shows the link to copy by hand instead.
	let copied = $state(false);
	let shownLink = $state('');
	async function copyLink() {
		const link = `${location.origin}/collections/${collectionId}`;
		// Copy before awaiting anything, while the click still counts as a user gesture
		const sharing = shared ? undefined : setShared(true);
		try {
			await navigator.clipboard.writeText(link);
			copied = true;
			setTimeout(() => (copied = false), 2000);
		} catch {
			shownLink = link;
		}
		await sharing;
	}

	function setDefaults(fields: { taggingMode?: TaggingMode; linkImageMode?: 'screenshot' | 'og' }) {
		if (collectionId) mutate(api.collections.update, { id: collectionId, ...fields });
		else mutate(api.viewPreferences.set, { key: 'home', ...fields });
	}
</script>

<div class="settings-menu">
	<Dropdown label="" title="settings">
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
				{#if collectionId}
					<div class="group">
						<span class="group-label">sharing</span>
						<div class="mode-options">
							<button class:active={!shared} onclick={() => setShared(false)}>private</button>
							<button class:active={shared} onclick={() => setShared(true)}>
								anyone with link
							</button>
						</div>
						<button onclick={copyLink}>
							{copied ? 'link copied' : shared ? 'copy link' : 'share and copy link'}
						</button>
						{#if shownLink}
							<input readonly value={shownLink} onfocus={(e) => e.currentTarget.select()} />
						{/if}
					</div>
				{/if}
				{#if showIngestion}
					<div class="group">
						<span class="group-label">{TAGGING_MODE_LABEL} default</span>
						<div class="mode-options">
							{#each taggingModeOptions as opt (opt.value)}
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
		padding: var(--pad-y);
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
		padding: var(--space-lg);
		display: flex;
		flex-direction: column;
		gap: var(--space-lg);
	}

	.group {
		display: flex;
		flex-direction: column;
		gap: var(--gap-sm);
	}

	.group-label {
		font-size: var(--text-base);
	}
</style>
