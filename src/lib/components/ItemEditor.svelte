<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { page } from '$app/state';
	import { api } from '../../convex/_generated/api.js';
	import type { Id } from '../../convex/_generated/dataModel.js';
	import type { DisplayItem } from '#lib/types.js';
	import { useDeleteItem, useMutation } from '#lib/convex.js';
	import { isBusy } from '#lib/itemDisplay.js';
	import { fontDisplayName, fontQuery } from '../../convex/lib/fonts.js';
	import { isWebUrl } from '../../convex/lib/urls.js';
	import { getCollectionsContext } from '#lib/context.js';
	import {
		TAGGING_MODE_LABEL,
		taggingModeOf,
		taggingModesFor,
		type TaggingMode
	} from '#lib/taggingModes.js';
	import IconOpenInNew from '~icons/material-symbols-light/open-in-new-sharp';
	import IconDelete from '~icons/material-symbols-light/delete-outline-sharp';

	interface Props {
		item: DisplayItem;
		// Someone else's item (a shared collection): shown, not edited
		readonly?: boolean;
		onClose: () => void;
	}

	let { item, readonly = false, onClose }: Props = $props();

	const mutate = useMutation();
	const deleteItem = useDeleteItem();
	const collections = getCollectionsContext();

	// ItemModal remounts the editor per item; pinning the id keeps the save on
	// unmount aimed at this item even while the modal already shows the next one
	const itemId = untrack(() => item._id);

	type Field = 'title' | 'description' | 'url' | 'content';
	const fields: Field[] = ['title', 'description', 'url', 'content'];

	// A field holds the user's text once they edit it; until then it follows live data
	// (e.g. the title the screenshot pipeline captures after the editor opened)
	const draft = $state<Partial<Record<Field, string>>>({});
	const value = (field: Field) => draft[field] ?? item[field] ?? '';
	const url = $derived(value('url'));
	const urlValid = $derived(!url || isWebUrl(url));
	let deleted = false;

	// Tag links search the user's own items, or for a visitor, this collection
	const searchHref = (q: string) =>
		`${readonly ? page.url.pathname : '/search'}?q=${encodeURIComponent(q)}`;

	// Sends only the edited fields ('' clears one; an invalid link keeps the saved
	// one); returns whether the edits are persisted (true when there was nothing to save)
	async function save(options?: { onError?: () => void }): Promise<boolean> {
		const changes: Partial<Record<Field, string>> = {};
		for (const field of fields) {
			const edited = draft[field];
			if (field === 'url' && !urlValid) continue;
			if (edited !== undefined && edited !== (item[field] ?? '')) changes[field] = edited;
		}
		if (Object.keys(changes).length === 0) return true;
		if ((await mutate(api.items.update, { id: itemId, ...changes }, options)) === undefined) {
			return false;
		}
		// Saved fields follow live data again, unless edited further meanwhile
		for (const field of fields) {
			if (changes[field] !== undefined && draft[field] === changes[field]) delete draft[field];
		}
		return true;
	}

	// Every way out (done, escape, arrows, links, browser back) unmounts the editor;
	// a failed save there is logged, not alerted while the user moves on
	onDestroy(() => {
		if (!deleted && !readonly) save({ onError: () => {} });
	});

	function handleDelete() {
		// Close first so the modal never shows "item not found" while the list updates
		deleteItem(itemId, () => {
			deleted = true;
			onClose();
		});
	}

	const imageBusy = $derived(isBusy(item.screenshotStatus));
	const tagBusy = $derived(isBusy(item.taggingStatus));
	const taggingMode = $derived(taggingModeOf(item));
	// Looking needs an image that isn't being replaced; content and off always work
	const canSetMode = (mode: TaggingMode) =>
		!tagBusy && (mode !== 'visual' || (!imageBusy && !!item.imageKey));

	// Clicking a mode re-fetches in that mode, so the active button doubles as refresh
	async function reimage(mode: 'screenshot' | 'og') {
		// Persist the draft first so the capture uses the url as edited
		if (!(await save())) return;
		mutate(api.screenshots.reimageItem, { itemId, mode });
	}

	async function retag(mode: TaggingMode) {
		// Persist the draft first so content tagging reads the url as edited
		if (!(await save())) return;
		mutate(api.tagging.retagItem, { itemId, mode });
	}

	function toggleCollection(collectionId: Id<'collections'>) {
		const toggle = item.collections.includes(collectionId)
			? api.items.removeFromCollection
			: api.items.addToCollection;
		mutate(toggle, { itemId, collectionId });
	}
</script>

<div class="editor-layout">
	<!-- Content Preview -->
	<div class="content-preview">
		{#if item.type === 'image' && item.imageUrl}
			<img src={item.imageUrl} alt={item.title ?? 'image'} />
		{:else if item.type === 'url'}
			{#if item.screenshotStatus === 'completed' && item.imageUrl}
				<img src={item.imageUrl} alt={item.title ?? item.url ?? 'screenshot'} />
			{:else}
				<div class="url-preview">
					<p class="url-text">{url}</p>
				</div>
			{/if}
		{:else if item.type === 'text'}
			<textarea
				class="text-content"
				bind:value={() => value('content'), (v) => (draft.content = v)}
				{readonly}></textarea>
		{/if}
	</div>
	<!-- Properties & Controls -->
	<div class="form">
		<div class="fields">
			<label>
				title
				<input type="text" bind:value={() => value('title'), (v) => (draft.title = v)} {readonly} />
			</label>

			{#if !readonly || item.description}
				<label>
					notes
					<textarea
						bind:value={() => value('description'), (v) => (draft.description = v)}
						rows="3"
						{readonly}></textarea>
				</label>
			{/if}

			{#if !readonly || url}
				<label>
					{item.type === 'url' ? 'url' : 'source url'}
					<div class="url-input-row">
						<input type="url" bind:value={() => url, (v) => (draft.url = v)} {readonly} />
						{#if urlValid && url}
							<a
								href={url}
								target="_blank"
								rel="noopener noreferrer"
								class="icon-filled"
								aria-label="open url"
							>
								<IconOpenInNew />
							</a>
						{/if}
					</div>
					{#if !urlValid && !readonly}
						<span class="status-text">links must start with http:// or https://</span>
					{/if}
				</label>
			{/if}

			{#if !readonly}
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
											checked={item.collections.includes(collection._id)}
											onchange={() => toggleCollection(collection._id)}
										/>
										{collection.name}
									</label>
								{/each}
							</div>
						{/if}
					</div>
				</div>
			{/if}

			{#if item.paletteHex && item.paletteHex.length > 0}
				<div class="tag-field">
					<div class="field-label">palette</div>
					<div class="palette-strip">
						{#each item.paletteHex as hex (hex)}
							<span class="palette-swatch" style:background={hex}></span>
						{/each}
					</div>
				</div>
			{/if}

			{#if item.fonts && item.fonts.length > 0}
				<div class="tag-field">
					<div class="field-label">fonts</div>
					<div class="chip-list">
						{#each item.fonts as font (font.family)}
							<a class="chip" href={searchHref(fontQuery(font))}>
								{fontDisplayName(font)}
							</a>
						{/each}
					</div>
				</div>
			{/if}

			{#if item.styles && item.styles.length > 0}
				<div class="tag-field">
					<div class="field-label">styles</div>
					<div class="chip-list">
						{#each item.styles as style (style)}
							<a class="chip" href={searchHref(style)}>{style}</a>
						{/each}
					</div>
				</div>
			{/if}

			{#if item.subject ?? item.ogDescription}
				<div class="tag-field">
					<div class="field-label">subject</div>
					<p class="subject-text">{item.subject ?? item.ogDescription}</p>
				</div>
			{/if}

			{#if item.aiTags && item.aiTags.length > 0}
				<div class="tag-field">
					<div class="field-label">search tags</div>
					<div class="chip-list">
						{#each item.aiTags as tag (tag)}
							<a class="chip" href={searchHref(tag)}>{tag}</a>
						{/each}
					</div>
				</div>
			{/if}

			{#if item.type === 'url' && !readonly}
				<div class="tag-field">
					<div class="field-label">link image</div>
					<div class="mode-options">
						<button
							class={{ active: (item.linkImageMode ?? 'screenshot') === 'screenshot' }}
							disabled={imageBusy || tagBusy}
							onclick={() => reimage('screenshot')}
						>
							screenshot
						</button>
						<button
							class={{ active: item.linkImageMode === 'og' }}
							disabled={imageBusy || tagBusy}
							onclick={() => reimage('og')}
						>
							og image
						</button>
					</div>
					{#if imageBusy}
						<p class="status-text">fetching image...</p>
					{:else if item.screenshotStatus === 'failed'}
						<p class="status-text">failed: {item.screenshotError}</p>
					{/if}
				</div>
			{/if}

			{#if !readonly}
				<div class="tag-field">
					<div class="field-label">{TAGGING_MODE_LABEL}</div>
					<!-- Clicking a mode re-tags in that mode, so the active button doubles as refresh -->
					<div class="mode-options">
						{#each taggingModesFor(item.type) as opt (opt.value)}
							<button
								class={{ active: taggingMode === opt.value }}
								disabled={!canSetMode(opt.value)}
								onclick={() => retag(opt.value)}
							>
								{opt.label}
							</button>
						{/each}
					</div>
					{#if tagBusy}
						<p class="status-text">tagging...</p>
					{:else if taggingMode === 'none'}
						<p class="status-text">ai off: not tagged, embedded or mapped</p>
					{/if}
					{#if item.taggingStatus === 'failed'}
						<p class="status-text">failed: {item.taggingError}</p>
					{/if}
				</div>
			{/if}

			<div class="meta">
				<p>added: {new Date(item.dateAdded).toLocaleString()}</p>
				<p>modified: {new Date(item.dateModified).toLocaleString()}</p>
			</div>
		</div>

		<div class="actions">
			<button onclick={onClose}>done</button>
			{#if !readonly}
				<button onclick={handleDelete} class="icon-filled danger" aria-label="delete item">
					<IconDelete />
				</button>
			{/if}
		</div>
	</div>
</div>

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

	/* The divider runs through the modal's padding, edge to edge */
	.form {
		width: 25rem;
		min-height: 0;
		margin-block: -1rem;
		padding: 1rem 0 1rem 1rem;
		border-left: 1px solid var(--border);
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

	/* Someone else's item: fields read as plain text */
	.fields [readonly],
	.text-content[readonly] {
		border-color: transparent;
		background: transparent;
		padding-inline: 0;
		resize: none;
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
		gap: 0.5rem;
		cursor: pointer;
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
			margin-block: 0;
			padding: 1rem;
			padding-bottom: 5rem;
			border-left: none;
			border-top: 1px solid var(--border);
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
