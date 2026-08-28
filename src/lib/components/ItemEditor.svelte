<script lang="ts">
	import { useConvexClient } from 'convex-svelte';
	import { api } from '../../convex/_generated/api.js';
	import type { Doc, Id } from '../../convex/_generated/dataModel.js';
	import { mutate } from '$lib/mutationHelper.js';
	import { getItemsContext, getCollectionsContext, getWriteTokenContext } from '$lib/context.js';
	import IconOpenInNew from '~icons/material-symbols-light/open-in-new-sharp';
	import IconCheck from '~icons/material-symbols/check';
	import IconDelete from '~icons/material-symbols-light/delete-outline-sharp';

	interface Props {
		itemId: Id<'items'>;
		onClose: () => void;
		onDelete: () => void;
	}

	let { itemId, onClose, onDelete }: Props = $props();

	const client = useConvexClient();
	const allItems = getItemsContext();
	const collections = getCollectionsContext();
	const getWriteToken = getWriteTokenContext();
	const writeToken = $derived(getWriteToken());

	// Find the specific item from context
	const item = $derived.by(() => {
		if (allItems.isLoading || allItems.error || !allItems.data) {
			return { isLoading: allItems.isLoading, error: allItems.error, data: null };
		}
		return {
			isLoading: false,
			error: null,
			data: allItems.data.find((i: Doc<'items'>) => i._id === itemId) ?? null
		};
	});

	let title = $state('');
	let description = $state('');
	let url = $state('');
	let content = $state('');
	let initialized = $state(false);

	$effect(() => {
		if (item.data && !initialized) {
			title = item.data.title ?? '';
			description = item.data.description ?? '';
			url = item.data.url ?? '';
			content = item.data.content ?? '';
			initialized = true;
		}
	});

	// Returns whether the edits are persisted (true when there was nothing to save)
	export async function save(): Promise<boolean> {
		const data = item.data;
		if (!data) return false;
		const unchanged =
			title === (data.title ?? '') &&
			description === (data.description ?? '') &&
			url === (data.url ?? '') &&
			content === (data.content ?? '');
		if (unchanged) return true;
		return (
			(await mutate(writeToken, async (token) => {
				await client.mutation(api.items.update, {
					id: itemId,
					title,
					description,
					url,
					content,
					token
				});
				return true;
			})) ?? false
		);
	}

	function handleDone() {
		save();
		onClose();
	}

	async function handleDelete() {
		// Close modal immediately to avoid showing "item not found" error
		// as Convex updates the items list in real-time
		onDelete();

		// Delete in background
		await mutate(writeToken, (token) => client.mutation(api.items.remove, { id: itemId, token }));
	}

	const imageBusy = $derived(
		item.data?.screenshotStatus === 'pending' || item.data?.screenshotStatus === 'processing'
	);
	const tagBusy = $derived(
		item.data?.taggingStatus === 'pending' || item.data?.taggingStatus === 'processing'
	);
	const hasTags = $derived(
		!!(item.data?.styles?.length || item.data?.aiTags?.length || item.data?.subject)
	);

	// Clicking a mode re-fetches in that mode, so the active button doubles as refresh
	async function reimage(mode: 'screenshot' | 'og') {
		// Persist the draft first so the capture uses the url as edited
		if (!(await save())) return;
		await mutate(writeToken, (token) =>
			client.mutation(api.screenshots.reimageItem, { itemId, mode, token })
		);
	}

	async function retag(mode?: 'visual' | 'text') {
		await mutate(writeToken, (token) =>
			client.mutation(api.tagging.retagItem, { itemId, mode, token })
		);
	}

	async function toggleCollection(collectionId: Id<'collections'>) {
		if (!item.data) return;
		if (item.data.collections.includes(collectionId)) {
			await mutate(writeToken, (token) =>
				client.mutation(api.items.removeFromCollection, { itemId, collectionId, token })
			);
		} else {
			await mutate(writeToken, (token) =>
				client.mutation(api.items.addToCollection, { itemId, collectionId, token })
			);
		}
	}
</script>

{#if item.isLoading}
	<p class="status-text">loading...</p>
{:else if item.error}
	<p class="status-text">error: {item.error.message}</p>
{:else if !item.data}
	<p class="status-text">item not found</p>
{:else}
	<div class="editor-layout">
		<!-- Content Preview -->
		<div class="content-preview">
			{#if item.data.type === 'image' && item.data.imageUrl}
				<img src={item.data.imageUrl} alt={item.data.title ?? 'image'} />
			{:else if item.data.type === 'url'}
				{#if item.data.screenshotStatus === 'completed' && item.data.imageUrl}
					<img src={item.data.imageUrl} alt={item.data.title ?? item.data.url ?? 'screenshot'} />
				{:else}
					<div class="url-preview">
						<p class="url-text">{url || item.data.url}</p>
					</div>
				{/if}
			{:else if item.data.type === 'text'}
				<textarea class="text-content" bind:value={content}></textarea>
			{/if}
		</div>
		<!-- Properties & Controls -->
		<div class="form">
			<div class="fields">
				<label>
					title
					<input type="text" bind:value={title} />
				</label>

				<label>
					notes
					<textarea bind:value={description} rows="3"></textarea>
				</label>

				<label>
					{item.data.type === 'url' ? 'url' : 'source url'}
					<div class="url-input-row">
						<input type="url" bind:value={url} />
						<a
							href={url}
							target="_blank"
							rel="noopener noreferrer"
							class="icon-filled"
							aria-label="open url"
						>
							<IconOpenInNew />
						</a>
					</div>
				</label>

				<div class="collections-field">
					<div class="field-label">collections</div>
					<div class="collections-container">
						{#if collections.isLoading}
							<p class="status-text">loading collections...</p>
						{:else if collections.data?.length === 0}
							<p class="status-text">no collections yet. <a href="/collections">create one</a></p>
						{:else}
							<div class="collection-list">
								{#each collections.data ?? [] as collection (collection._id)}
									<label class="checkbox-label">
										<input
											type="checkbox"
											checked={item.data.collections.includes(collection._id)}
											onchange={() => toggleCollection(collection._id)}
										/>
										<span class="checkbox">
											{#if item.data.collections.includes(collection._id)}
												<IconCheck />
											{/if}
										</span>
										{collection.name}
									</label>
								{/each}
							</div>
						{/if}
					</div>
				</div>

				{#if item.data.paletteHex && item.data.paletteHex.length > 0}
					<div class="tag-field">
						<div class="field-label">palette</div>
						<div class="palette-strip">
							{#each item.data.paletteHex as hex (hex)}
								<span class="palette-swatch" style:background={hex}></span>
							{/each}
						</div>
					</div>
				{/if}

				{#if item.data.styles && item.data.styles.length > 0}
					<div class="tag-field">
						<div class="field-label">styles</div>
						<div class="chip-list">
							{#each item.data.styles as style (style)}
								<a class="chip" href="/search?q={encodeURIComponent(style)}">{style}</a>
							{/each}
						</div>
					</div>
				{/if}

				{#if item.data.subject ?? item.data.ogDescription}
					<div class="tag-field">
						<div class="field-label">subject</div>
						<p class="subject-text">{item.data.subject ?? item.data.ogDescription}</p>
					</div>
				{/if}

				{#if item.data.aiTags && item.data.aiTags.length > 0}
					<div class="tag-field">
						<div class="field-label">search tags</div>
						<div class="chip-list">
							{#each item.data.aiTags as tag (tag)}
								<a class="chip" href="/search?q={encodeURIComponent(tag)}">{tag}</a>
							{/each}
						</div>
					</div>
				{/if}

				{#if item.data.type === 'url'}
					<div class="tag-field">
						<div class="field-label">link image</div>
						<div class="mode-options">
							<button
								class:active={(item.data.linkImageMode ?? 'screenshot') === 'screenshot'}
								disabled={imageBusy || tagBusy}
								onclick={() => reimage('screenshot')}
							>
								screenshot
							</button>
							<button
								class:active={item.data.linkImageMode === 'og'}
								disabled={imageBusy || tagBusy}
								onclick={() => reimage('og')}
							>
								og image
							</button>
						</div>
						{#if imageBusy}
							<p class="status-text">fetching image...</p>
						{:else if item.data.screenshotStatus === 'failed'}
							<p class="status-text">failed: {item.data.screenshotError}</p>
						{/if}
					</div>
				{/if}

				{#if item.data.type !== 'text'}
					<div class="tag-field">
						<div class="field-label">ai tagging</div>
						{#if item.data.type === 'url'}
							<!-- Clicking a mode re-tags in that mode, so the active button doubles as refresh -->
							<div class="mode-options">
								<button
									class:active={(item.data.taggingMode ?? 'visual') === 'visual'}
									disabled={tagBusy || imageBusy || !item.data.imageKey}
									onclick={() => retag('visual')}
								>
									visual
								</button>
								<button
									class:active={item.data.taggingMode === 'text'}
									disabled={tagBusy}
									onclick={() => retag('text')}
								>
									text
								</button>
							</div>
							{#if tagBusy}
								<p class="status-text">tagging...</p>
							{/if}
						{:else}
							<button
								disabled={tagBusy || imageBusy || !item.data.imageKey}
								onclick={() => retag()}
							>
								{tagBusy ? 'tagging...' : hasTags ? 're-tag' : 'tag'}
							</button>
						{/if}
						{#if item.data.taggingStatus === 'failed'}
							<p class="status-text">failed: {item.data.taggingError}</p>
						{/if}
					</div>
				{/if}

				<div class="meta">
					<p>added: {new Date(item.data.dateAdded).toLocaleString()}</p>
					<p>modified: {new Date(item.data.dateModified).toLocaleString()}</p>
				</div>
			</div>

			<div class="actions">
				<button onclick={handleDone}>done</button>
				<button onclick={handleDelete} class="icon-filled danger" aria-label="delete item">
					<IconDelete />
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.editor-layout {
		display: flex;
		gap: 1rem;
		align-items: stretch;
		min-height: 0;
		height: 100%;
	}

	.content-preview {
		display: grid;
		place-items: center;
		flex: 1;
		min-height: 0;
		container-type: size;
	}

	.form {
		width: 25rem;
		min-height: 0;
	}

	.fields {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		/* extend through the modal padding so the scrollbar sits at its edge */
		margin-right: -1rem;
		padding-right: 1rem;
	}

	.content-preview img {
		width: 100cqw;
		height: 100cqh;
		object-fit: contain;
	}

	.url-preview {
		width: 100%;
		padding: 0.5rem;
		border: 1px solid var(--border);
		background: var(--bg-2);
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.url-preview .url-text {
		color: var(--txt-3);
		word-break: break-all;
		text-align: center;
	}

	.text-content {
		width: 100%;
		height: 100%;
		flex: 1;
		resize: vertical;
		font-family: var(--font);
		font-size: 1rem;
	}

	.collections-field,
	.tag-field {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.field-label {
		font-size: 1rem;
	}

	.palette-strip {
		display: flex;
		height: 1.75rem;
		border: 1px solid var(--border);
	}

	.palette-swatch {
		flex: 1;
	}

	.subject-text {
		font-size: 0.875rem;
		color: var(--txt-2);
	}

	.chip-list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
	}

	.chip {
		padding: 0.125rem 0.5rem;
		font-size: 0.875rem;
		background: var(--bg-2);
		border: 1px solid var(--border);
		color: var(--txt-2);
		text-decoration: none;
	}

	a.chip:hover {
		border-color: var(--txt-3);
		color: var(--txt-1);
	}

	.collections-container {
		border: 1px solid var(--border);
		padding: 1rem;
		max-height: 12rem;
		overflow-y: auto;
	}

	.collection-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.checkbox-label {
		flex-direction: row;
		align-items: center;
		gap: 1rem;
		cursor: pointer;
	}

	.checkbox-label input {
		position: absolute;
		opacity: 0;
		pointer-events: none;
	}

	.checkbox {
		width: 1.125rem;
		height: 1.125rem;
		border: 1px solid var(--border);
		background: var(--bg-2);
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}

	.checkbox-label:hover .checkbox {
		border-color: var(--txt-3);
	}

	.checkbox-label input:checked + .checkbox {
		background: var(--txt-2);
		border-color: var(--txt-2);
		color: var(--bg-1);
	}

	.checkbox :global(svg) {
		width: 0.875rem;
		height: 0.875rem;
	}

	.url-input-row {
		display: flex;
		gap: 0.5rem;
	}

	.url-input-row input {
		flex: 1;
	}

	.actions {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}

	.actions button:first-child {
		flex: 1;
	}

	@media (max-width: 768px) {
		.editor-layout {
			display: block;
			height: auto;
		}

		.content-preview {
			display: block;
			padding: 1rem;
			container-type: normal;
		}

		.fields {
			overflow-y: visible;
			margin-right: 0;
			padding-right: 0;
		}

		.content-preview img {
			width: 100%;
			height: auto;
			display: block;
		}

		.form {
			width: 100%;
			padding: 1rem;
			padding-bottom: 5rem;
		}

		.text-content {
			min-height: 30vh;
		}

		.actions {
			display: flex;
			gap: 0.5rem;
		}
	}
</style>
