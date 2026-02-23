<script lang="ts">
	import { getContext } from 'svelte';
	import { useConvexClient } from 'convex-svelte';
	import { useUploadFile } from '@convex-dev/r2/svelte';
	import { api } from '../../convex/_generated/api.js';
	import type { Id } from '../../convex/_generated/dataModel.js';
	import { mutate } from '$lib/mutationHelper.js';
	import IconUpload from '~icons/material-symbols-light/upload-sharp';

	interface Props {
		collectionId?: Id<'collections'>;
	}

	let { collectionId }: Props = $props();

	const client = useConvexClient();
	const uploadFile = useUploadFile(api.r2);
	const getWriteToken = getContext<() => string | null>('writeToken');
	const writeToken = $derived(getWriteToken());

	let inputValue = $state('');
	let isAdding = $state(false);
	let isDragging = $state(false);
	let textareaEl: HTMLTextAreaElement;
	let resizeFrame: number | null = null;

	function autoResize() {
		if (!textareaEl) return;

		// Cancel any pending resize
		if (resizeFrame) cancelAnimationFrame(resizeFrame);

		// Batch DOM operations in a single animation frame to avoid layout thrashing
		resizeFrame = requestAnimationFrame(() => {
			if (!textareaEl) return;
			// Reset height first so scrollHeight recalculates
			textareaEl.style.height = 'auto';
			textareaEl.style.height = textareaEl.scrollHeight + 'px';
			resizeFrame = null;
		});
	}

	function isUrl(str: string): boolean {
		try {
			new URL(str);
			return true;
		} catch {
			return false;
		}
	}

	function getImageDimensions(file: File): Promise<{ width: number; height: number }> {
		return new Promise((resolve) => {
			const img = new Image();
			img.onload = () => {
				resolve({ width: img.naturalWidth, height: img.naturalHeight });
				URL.revokeObjectURL(img.src);
			};
			img.onerror = () => {
				resolve({ width: 0, height: 0 });
				URL.revokeObjectURL(img.src);
			};
			img.src = URL.createObjectURL(file);
		});
	}

	async function handleSubmit() {
		const value = inputValue.trim();
		if (!value) return;

		isAdding = true;
		try {
			const result = await mutate(writeToken, (token) => {
				if (isUrl(value)) {
					return client.mutation(api.items.add, {
						type: 'url',
						url: value,
						collections: collectionId ? [collectionId] : undefined,
						token
					});
				} else {
					return client.mutation(api.items.add, {
						type: 'text',
						content: value,
						collections: collectionId ? [collectionId] : undefined,
						token
					});
				}
			});
			if (result !== null) {
				inputValue = '';
				if (textareaEl) textareaEl.style.height = 'auto';
			}
		} finally {
			isAdding = false;
		}
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
		if (!items) return;

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
		isAdding = true;
		try {
			const dimensions = await getImageDimensions(file);
			const key = await uploadFile(file);
			await mutate(writeToken, (token) =>
				client.mutation(api.items.add, {
					type: 'image',
					imageKey: key,
					imageWidth: dimensions.width || undefined,
					imageHeight: dimensions.height || undefined,
					title: file.name || 'Pasted image',
					collections: collectionId ? [collectionId] : undefined,
					token
				})
			);
		} finally {
			isAdding = false;
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			handleSubmit();
		}
	}

	function handleDragOver(event: DragEvent) {
		event.preventDefault();
		isDragging = true;
	}

	function handleDragLeave(event: DragEvent) {
		event.preventDefault();
		isDragging = false;
	}

	async function handleDrop(event: DragEvent) {
		event.preventDefault();
		isDragging = false;

		const file = event.dataTransfer?.files[0];
		if (file?.type.startsWith('image/')) {
			await uploadImage(file);
		}
	}
</script>

<div class="input-wrapper">
	<label class="icon-filled upload-btn">
		<input type="file" accept="image/*" onchange={handleFileUpload} disabled={isAdding} />
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
			disabled={isAdding}
			rows="1"
		></textarea>
	</div>
</div>

<style>
	.input-wrapper {
		display: flex;
		gap: 0.5rem;
		align-items: flex-start;
	}

	.input-container {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 0.5rem;
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
		min-height: 2.5rem;
		max-height: calc(1.5rem * 8);
		overflow-y: auto;
		width: 100%;
	}

	.upload-btn {
		flex-shrink: 0;
		cursor: pointer;
	}

	.upload-btn input {
		display: none;
	}
</style>
