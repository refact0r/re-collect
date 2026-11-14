<script lang="ts">
	import { api } from '../../convex/_generated/api.js';
	import type { Id } from '../../convex/_generated/dataModel.js';
	import { reportError, useMutation } from '#lib/convex.js';
	import { isWebUrl } from '../../convex/lib/urls.js';
	import IconUpload from '~icons/material-symbols-light/upload-sharp';

	interface Props {
		collectionId?: Id<'collections'>;
	}

	let { collectionId }: Props = $props();

	const mutate = useMutation();
	const collections = $derived(collectionId ? [collectionId] : undefined);

	// Resolves to the uploaded object's key, or undefined once a failure is reported
	async function uploadFile(file: File): Promise<string | undefined> {
		const upload = await mutate(api.r2.generateUploadUrl, {});
		if (!upload) return;
		try {
			const res = await fetch(upload.url, {
				method: 'PUT',
				headers: { 'Content-Type': file.type },
				body: file
			});
			if (!res.ok) throw new Error(`Failed to upload file: ${res.status}`);
			return upload.key;
		} catch (error) {
			reportError(error);
		}
	}

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
		const dimensions = await getImageDimensions(file);
		const key = await uploadFile(file);
		if (key) {
			await mutate(api.items.add, {
				type: 'image',
				imageKey: key,
				imageWidth: dimensions.width || undefined,
				imageHeight: dimensions.height || undefined,
				title: file.name || 'Pasted image',
				collections
			});
		}
		isAdding = false;
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
			rows="1"></textarea>
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
