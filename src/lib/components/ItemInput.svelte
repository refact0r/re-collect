<script lang="ts">
	import { useConvexClient } from 'convex-svelte';
	import { useUploadFile } from '@convex-dev/r2/svelte';
	import { api } from '../../convex/_generated/api.js';
	import type { Id } from '../../convex/_generated/dataModel.js';

	interface Props {
		collectionId?: Id<'collections'>;
	}

	let { collectionId }: Props = $props();

	const client = useConvexClient();
	const uploadFile = useUploadFile(api.r2);

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
			// Read phase
			const scrollHeight = textareaEl.scrollHeight;
			// Write phase
			textareaEl.style.height = 'auto';
			textareaEl.style.height = scrollHeight + 'px';
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
			if (isUrl(value)) {
				await client.mutation(api.items.add, {
					type: 'url',
					url: value,
					collections: collectionId ? [collectionId] : undefined
				});
			} else {
				await client.mutation(api.items.add, {
					type: 'text',
					content: value,
					collections: collectionId ? [collectionId] : undefined
				});
			}
			inputValue = '';
			if (textareaEl) textareaEl.style.height = 'auto';
		} finally {
			isAdding = false;
		}
	}

	async function handleFileUpload(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		isAdding = true;
		try {
			const dimensions = await getImageDimensions(file);
			const key = await uploadFile(file);
			await client.mutation(api.items.add, {
				type: 'image',
				imageKey: key,
				imageWidth: dimensions.width || undefined,
				imageHeight: dimensions.height || undefined,
				title: file.name,
				collections: collectionId ? [collectionId] : undefined
			});
			input.value = '';
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
		if (!file) return;

		if (file.type.startsWith('image/')) {
			isAdding = true;
			try {
				const dimensions = await getImageDimensions(file);
				const key = await uploadFile(file);
				await client.mutation(api.items.add, {
					type: 'image',
					imageKey: key,
					imageWidth: dimensions.width || undefined,
					imageHeight: dimensions.height || undefined,
					title: file.name,
					collections: collectionId ? [collectionId] : undefined
				});
			} finally {
				isAdding = false;
			}
		}
	}
</script>

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
		placeholder="paste a url, type text, or drag an image..."
		disabled={isAdding}
		rows="1"
	></textarea>
	<label class="upload-btn">
		<input type="file" accept="image/*" onchange={handleFileUpload} disabled={isAdding} />
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linejoin="miter"
			stroke-linecap="square"
		>
			<path d="M21 17v4H3v-4" />
			<path d="M7 8l5-5 5 5M12 4v11" />
		</svg>
	</label>
</div>

<style>
	/* Uses global .input-container styles from app.css */
	.input-container.dragging {
		border-color: var(--txt-2);
		border-style: dashed;
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
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		cursor: pointer;
		flex-shrink: 0;
		margin-right: 0.25rem;
	}

	.upload-btn:hover {
		background: var(--bg-3);
	}

	.upload-btn input {
		display: none;
	}

	.upload-btn svg {
		width: 1.25rem;
		height: 1.25rem;
	}
</style>
