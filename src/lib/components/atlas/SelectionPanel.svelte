<script lang="ts">
	import IconClose from '~icons/material-symbols-light/close-sharp';
	import { api } from '../../../convex/_generated/api.js';
	import type { Id } from '../../../convex/_generated/dataModel.js';
	import { colorStrips, countStyles, hostOf, itemLabel } from '#lib/atlas.js';
	import { useMutation } from '#lib/convex.js';
	import { getItemUrl, shouldDisplayAsImage } from '#lib/itemDisplay.js';
	import type { DisplayItem } from '#lib/types.js';
	import { isWebUrl } from '../../../convex/lib/urls.js';
	import ColorStrip from './ColorStrip.svelte';

	interface Props {
		selected: DisplayItem[];
		// Set when the selection is a map region: its name and most distinctive styles, strongest first
		region?: { name: string; styles: string[] };
		neighbours: DisplayItem[];
		collections: { _id: Id<'collections'>; name: string }[];
		activeStyles: Set<string>;
		onselect: (ids: Id<'items'>[]) => void;
		onstyle: (style: string) => void;
		onclose: () => void;
	}

	let {
		selected,
		region,
		neighbours,
		collections,
		activeStyles,
		onselect,
		onstyle,
		onclose
	}: Props = $props();

	const mutate = useMutation();

	const single = $derived(selected.length === 1 ? selected[0] : null);
	const heading = $derived(
		single ? itemLabel(single) : (region?.name ?? `${selected.length} selected`)
	);
	const blurb = $derived(single && (single.subject ?? single.ogDescription));
	const link = $derived(single?.url && isWebUrl(single.url) ? single.url : null);
	const groupStyles = $derived.by(() => {
		if (single) return [];
		if (region?.styles.length) return region.styles.slice(0, 6);
		return countStyles(selected)
			.slice(0, 6)
			.map((s) => s.name);
	});
	const groupColors = $derived(single ? null : colorStrips(selected));

	/* add to collection */

	let adding = $state<Id<'collections'> | null>(null);
	let newName = $state('');
	let creating = $state(false);

	const inCollection = (collectionId: Id<'collections'>) =>
		selected.filter((item) => item.collections.includes(collectionId)).length;

	function inLabel(count: number) {
		if (count === 0) return '';
		return single ? 'in' : `${count} of ${selected.length}`;
	}

	async function addTo(collectionId: Id<'collections'>) {
		const missing = selected
			.filter((item) => !item.collections.includes(collectionId))
			.map((item) => item._id);
		adding = collectionId;
		for (const itemId of missing) {
			if ((await mutate(api.items.addToCollection, { itemId, collectionId })) === undefined) break;
		}
		adding = null;
	}

	async function create(e: SubmitEvent) {
		e.preventDefault();
		const name = newName.trim();
		if (!name) return;
		creating = true;
		const collectionId = await mutate(api.collections.create, { name });
		if (collectionId) {
			newName = '';
			await addTo(collectionId);
		}
		creating = false;
	}
</script>

{#snippet thumbs(items: DisplayItem[])}
	<div class="thumbs">
		{#each items as item (item._id)}
			{@const label = itemLabel(item)}
			<button class="thumb" title={label} aria-label={label} onclick={() => onselect([item._id])}>
				{#if item.imageUrl}
					<img src={item.imageUrl} alt="" loading="lazy" />
				{:else}
					<span>{label}</span>
				{/if}
			</button>
		{/each}
	</div>
{/snippet}

{#snippet styleChips(styles: string[])}
	<div class="chips">
		{#each styles as style (style)}
			<button
				class={['chip', { on: activeStyles.has(style) }]}
				aria-pressed={activeStyles.has(style)}
				onclick={() => onstyle(style)}
			>
				{style}
			</button>
		{/each}
	</div>
{/snippet}

{#snippet palette(hexes: string[])}
	{#if hexes.length > 0}
		<div class="palette">
			{#each hexes as hex, i (i)}
				<span style:background={hex}></span>
			{/each}
		</div>
	{/if}
{/snippet}

<div class="panel">
	<div class="header">
		<h3 class={{ clamp: !!single }}>{heading}</h3>
		{#if !single && region}
			<span class="num">{selected.length}</span>
		{/if}
		<button class="icon close" aria-label="close" onclick={onclose}><IconClose /></button>
	</div>

	<div class="body">
		{#if single}
			<section>
				{#if shouldDisplayAsImage(single)}
					<img class="preview" src={single.imageUrl} alt={heading} />
				{:else}
					<div class="text-block">{single.content || blurb || single.url || heading}</div>
				{/if}
				{#if hostOf(single.url)}
					<span class="quiet">{hostOf(single.url)}</span>
				{/if}
				{#if blurb}
					<p class="blurb">{blurb}</p>
				{/if}
				{@render palette(single.paletteHex ?? [])}
				{#if single.styles?.length}
					{@render styleChips(single.styles)}
				{/if}
				<div class="actions">
					<a class="button" href={getItemUrl(single._id)}>open</a>
					{#if link}
						<a class="button" href={link} target="_blank" rel="noreferrer">visit</a>
					{/if}
				</div>
			</section>

			{#if neighbours.length > 0}
				<section>
					<h4>nearby</h4>
					{@render thumbs(neighbours)}
				</section>
			{/if}
		{:else}
			<section class="members">
				<div class="group">
					{@render thumbs(selected)}
				</div>
				{#if groupColors && (groupColors.hue.length > 0 || groupColors.tone.length > 0)}
					<div class="colors">
						{#if groupColors.hue.length > 0}
							<ColorStrip swatches={groupColors.hue} />
						{/if}
						{#if groupColors.tone.length > 0}
							<ColorStrip swatches={groupColors.tone} />
						{/if}
					</div>
				{/if}
				{#if groupStyles.length > 0}
					{@render styleChips(groupStyles)}
				{/if}
			</section>
		{/if}

		<section>
			<h4>add to collection</h4>
			<form class="create" onsubmit={create}>
				<input
					type="text"
					placeholder="new collection"
					aria-label="new collection name"
					bind:value={newName}
					disabled={creating}
				/>
				<button type="submit" disabled={creating || !newName.trim()}>create</button>
			</form>
			{#if collections.length > 0}
				<div class="rows">
					{#each collections as collection (collection._id)}
						{@const count = inCollection(collection._id)}
						<button
							class="row"
							disabled={adding === collection._id || count === selected.length}
							onclick={() => addTo(collection._id)}
						>
							<span class="name">{collection.name}</span>
							<span class="num">{adding === collection._id ? 'adding...' : inLabel(count)}</span>
						</button>
					{/each}
				</div>
			{/if}
		</section>
	</div>
</div>

<style>
	.panel {
		height: 100%;
		min-height: 0;
		display: flex;
		flex-direction: column;
		font-size: 0.8125rem;
	}

	.body {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
	}

	.header {
		flex-shrink: 0;
		border-bottom: 1px solid var(--border);
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		padding: 0.5rem 0.25rem 0.5rem 0.75rem;
	}

	h3 {
		flex: 1;
		min-width: 0;
		padding-top: 0.125rem;
		font-size: 0.875rem;
		overflow-wrap: anywhere;
	}

	h3.clamp {
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		overflow: hidden;
	}

	.header .num {
		padding-top: 0.125rem;
	}

	button.close {
		padding: 0.125rem;
	}

	button.close :global(svg) {
		width: 1.25rem;
		height: 1.25rem;
	}

	section {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem 0.75rem;
	}

	section + section {
		border-top: 1px solid var(--border);
	}

	h4 {
		font-size: 0.75rem;
		font-weight: var(--font-weight);
		color: var(--txt-3);
	}

	.preview {
		display: block;
		width: 100%;
		height: auto;
		max-height: 14rem;
		object-fit: contain;
		background: var(--bg-2);
	}

	.text-block {
		padding: 0.5rem;
		border: 1px solid var(--border);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 8;
		line-clamp: 8;
		overflow: hidden;
	}

	.quiet,
	.num {
		color: var(--txt-3);
		font-variant-numeric: tabular-nums;
	}

	.blurb {
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		overflow: hidden;
	}

	.palette {
		display: flex;
		height: 0.5rem;
	}

	.palette span {
		flex: 1;
	}

	.colors {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
	}

	.chip {
		padding: 0 0.375rem;
		font-size: 0.8125rem;
		background: var(--bg-2);
		color: var(--txt-2);
	}

	.chip:hover {
		border-color: var(--txt-3);
		background: var(--bg-2);
	}

	.chip.on {
		background: var(--txt-2);
		border-color: var(--txt-2);
		color: var(--bg-1);
	}

	.actions {
		display: flex;
		gap: 0.5rem;
	}

	.button {
		flex: 1;
		padding: 0.25rem 0.5rem;
		text-align: center;
		text-decoration: none;
		background: var(--bg-2);
		border: 1px solid var(--border);
	}

	.button:hover {
		background: var(--bg-3);
		color: var(--txt-1);
	}

	.button:focus-visible {
		outline: 1px solid var(--txt-3);
		outline-offset: 1px;
	}

	.thumbs {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(3.25rem, 1fr));
		gap: 0.25rem;
	}

	/* The group's thumbnails run four across and show four full rows before
	   scrolling: four square cells and their gaps are as tall as the box is wide */
	.members {
		container-type: inline-size;
	}

	.group {
		max-height: 100cqw;
		overflow-y: auto;
	}

	.group .thumbs {
		grid-template-columns: repeat(4, 1fr);
	}

	.thumb {
		aspect-ratio: 1;
		min-width: 0;
		padding: 0;
		border: 1px solid transparent;
		background: var(--bg-2);
		overflow: hidden;
	}

	.thumb:hover {
		border-color: var(--txt-3);
		background: var(--bg-2);
	}

	.thumb img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		background: var(--bg-2);
	}

	.thumb span {
		padding: 0.125rem;
		font-size: 0.625rem;
		line-height: 1.2;
		color: var(--txt-3);
		overflow: hidden;
		overflow-wrap: anywhere;
		max-height: 100%;
	}

	.rows {
		display: flex;
		flex-direction: column;
		margin-inline: -0.375rem;
	}

	.row {
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.125rem 0.375rem;
		font-size: 0.8125rem;
		background: transparent;
		border: none;
		text-align: left;
	}

	.row:hover {
		background: var(--bg-2);
	}

	.row:disabled,
	.row:disabled:hover {
		background: transparent;
	}

	.name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.create {
		display: flex;
	}

	.create input {
		flex: 1;
		min-width: 0;
		padding: 0.25rem 0.5rem;
		font-size: 0.8125rem;
	}

	.create button {
		padding: 0.25rem 0.5rem;
		font-size: 0.8125rem;
		border-left: none;
	}
</style>
