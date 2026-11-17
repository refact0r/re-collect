<script lang="ts">
	import { api } from '../../convex/_generated/api.js';
	import type { Id } from '../../convex/_generated/dataModel.js';
	import type { FunctionReturnType } from 'convex/server';
	import { reportError, useAction, useMutation, useQueryOnce } from '#lib/convex.js';
	import { notify } from '#lib/notice.svelte.js';
	import { RASTER_IMAGE_TYPES } from '../../convex/lib/images.js';
	import { isWebUrl } from '../../convex/lib/urls.js';
	import DuplicateConfirm from './DuplicateConfirm.svelte';
	import IconUpload from '~icons/material-symbols-light/upload-sharp';

	interface Props {
		collectionId?: Id<'collections'>;
	}

	let { collectionId }: Props = $props();

	const mutate = useMutation();
	const act = useAction();
	const queryOnce = useQueryOnce();
	const collections = $derived(collectionId ? [collectionId] : undefined);

	// Resolves to the uploaded object's key, or undefined once a failure is reported.
	// The URL only takes a PUT of the declared type, and the server checks the
	// bytes before items.add will accept the key.
	async function uploadFile(file: File): Promise<string | undefined> {
		const upload = await mutate(api.r2.generateUploadUrl, { contentType: file.type });
		if (!upload) return;
		try {
			const res = await fetch(upload.url, {
				method: 'PUT',
				headers: { 'Content-Type': file.type },
				body: file
			});
			if (!res.ok) throw new Error(`Failed to upload file: ${res.status}`);
		} catch (error) {
			reportError(error);
			return;
		}
		const verified = await act(api.imageImport.verifyUpload, { key: upload.key });
		return verified === undefined ? undefined : upload.key;
	}

	let inputValue = $state('');
	let isAdding = $state(false);
	let isDragging = $state(false);
	let textareaEl: HTMLTextAreaElement;
	let resizeFrame: number | null = null;

	// One resize per frame, however fast the input comes
	function autoResize() {
		if (resizeFrame) cancelAnimationFrame(resizeFrame);
		resizeFrame = requestAnimationFrame(() => {
			if (!textareaEl) return;
			// From 'auto', so scrollHeight can shrink too
			textareaEl.style.height = 'auto';
			textareaEl.style.height = textareaEl.scrollHeight + 'px';
			resizeFrame = null;
		});
	}

	// A link already in the library waits here for the user to add it anyway or cancel
	let duplicate = $state<{
		value: string;
		matches: FunctionReturnType<typeof api.items.findByUrl>;
	} | null>(null);

	async function handleSubmit() {
		const value = inputValue.trim();
		if (!value || isAdding) return;

		isAdding = true;
		if (isWebUrl(value)) {
			// A failed check just skips the warning
			const matches = await queryOnce(api.items.findByUrl, { url: value }, { onError: () => {} });
			if (matches?.length) {
				duplicate = { value, matches };
				isAdding = false;
				return;
			}
		}
		await add(value);
	}

	async function add(value: string) {
		isAdding = true;
		const added = await mutate(
			api.items.add,
			isWebUrl(value)
				? { type: 'url', url: value, collections }
				: { type: 'text', content: value, collections }
		);
		isAdding = false;
		if (added !== undefined) {
			inputValue = '';
			if (textareaEl) textareaEl.style.height = 'auto';
		}
	}

	function addDuplicate() {
		if (!duplicate) return;
		const { value } = duplicate;
		duplicate = null;
		add(value);
	}

	async function handleFileUpload(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		await uploadImage(file);
		input.value = '';
	}

	async function handlePaste(event: ClipboardEvent) {
		const items = event.clipboardData?.items;
		if (!items || isAdding) return;

		for (const item of items) {
			if (item.type.startsWith('image/')) {
				event.preventDefault();
				const file = item.getAsFile();
				if (!file) return;
				await uploadImage(file);
				return;
			}
		}
	}

	async function uploadImage(file: File) {
		// The server refuses anything else, so don't upload it first
		if (!RASTER_IMAGE_TYPES.includes(file.type)) {
			notify('that is not a supported image', { error: true });
			return;
		}
		isAdding = true;
		const key = await uploadFile(file);
		if (key) {
			await mutate(api.items.add, {
				type: 'image',
				imageKey: key,
				title: file.name || 'Pasted image',
				collections
			});
		}
		isAdding = false;
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
			event.preventDefault();
			handleSubmit();
		}
	}

	function handleDragOver(event: DragEvent) {
		event.preventDefault();
		isDragging = true;
	}

	// Moving onto the textarea leaves the container too
	function handleDragLeave(event: DragEvent) {
		const container = event.currentTarget as HTMLElement;
		if (!container.contains(event.relatedTarget as Node | null)) isDragging = false;
	}

	// An image is added at once; a link or text goes into the input to check first
	async function handleDrop(event: DragEvent) {
		event.preventDefault();
		isDragging = false;
		const data = event.dataTransfer;
		if (!data || isAdding) return;

		const file = data.files[0];
		if (file?.type.startsWith('image/')) {
			await uploadImage(file);
			return;
		}
		// Other files, whose text some browsers give as a file:// path
		if (file) return;
		// uri-list holds one link per line, with # comments
		const link = data
			.getData('text/uri-list')
			.split(/\r?\n/)
			.find((line) => line && !line.startsWith('#'));
		const text = link ?? data.getData('text/plain');
		if (!text) return;
		inputValue = text;
		textareaEl.focus();
		autoResize();
	}
</script>

{#if duplicate}
	<DuplicateConfirm
		matches={duplicate.matches}
		{collectionId}
		onAdd={addDuplicate}
		onCancel={() => (duplicate = null)}
		onView={() => (duplicate = null)}
	/>
{/if}

<div class="input-wrapper">
	<label class="icon-filled upload-btn">
		<input
			type="file"
			accept={RASTER_IMAGE_TYPES.join(',')}
			onchange={handleFileUpload}
			disabled={isAdding}
		/>
		<IconUpload />
	</label>
	<div
		class="input-container"
		class:dragging={isDragging}
		ondragover={handleDragOver}
		ondragleave={handleDragLeave}
		ondrop={handleDrop}
		role="region"
		aria-label="File drop zone"
	>
		<textarea
			bind:this={textareaEl}
			bind:value={inputValue}
			oninput={autoResize}
			onkeydown={handleKeydown}
			onpaste={handlePaste}
			placeholder="paste a url, image, or type text..."
			readonly={isAdding}
			rows="1"></textarea>
	</div>
</div>

<style>
	.input-wrapper {
		display: flex;
		gap: var(--gap);
		align-items: flex-start;
	}

	.input-container {
		flex: 1;
		display: flex;
		align-items: center;
		gap: var(--gap);
		border: 1px solid var(--border);
		background: var(--bg-2);
	}

	.input-container:focus-within {
		border-color: var(--txt-3);
	}

	.input-container.dragging {
		border-color: var(--txt-2);
		border-style: dashed;
	}

	.input-container textarea {
		border: none;
		background: transparent;
	}

	textarea {
		flex: 1;
		resize: none;
		min-height: calc(1.5rem + 2 * var(--pad-y));
		max-height: calc(1.5rem * 8);
		overflow-y: auto;
		width: 100%;
	}

	/* Adding: readonly rather than disabled, which would drop focus */
	textarea[readonly] {
		color: var(--txt-3);
	}

	.upload-btn {
		flex-shrink: 0;
		cursor: pointer;
	}

	.upload-btn input {
		display: none;
	}
</style>
