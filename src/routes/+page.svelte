<script lang="ts">
	import { getContext } from 'svelte';
	import { useConvexClient } from 'convex-svelte';
	import { useUploadFile } from '@convex-dev/r2/svelte';
	import { api } from '../convex/_generated/api.js';
	import ItemGrid from '$lib/components/ItemGrid.svelte';

	const client = useConvexClient();
	const items = getContext<ReturnType<typeof import('convex-svelte').useQuery>>('items');
	const uploadFile = useUploadFile(api.r2);

	let inputValue = $state('');
	let isAdding = $state(false);
	let isDragging = $state(false);

	function isUrl(str: string): boolean {
		try {
			new URL(str);
			return true;
		} catch {
			return false;
		}
	}

	async function handleSubmit() {
		const value = inputValue.trim();
		if (!value) return;

		isAdding = true;
		try {
			if (isUrl(value)) {
				await client.mutation(api.items.add, {
					type: 'url',
					url: value
				});
			} else {
				await client.mutation(api.items.add, {
					type: 'text',
					content: value
				});
			}
			inputValue = '';
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
			// Upload to R2 and get the key
			const key = await uploadFile(file);

			// Create the item with the R2 key
			await client.mutation(api.items.add, {
				type: 'image',
				imageKey: key,
				title: file.name
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

		// Only handle image files
		if (file.type.startsWith('image/')) {
			isAdding = true;
			try {
				const key = await uploadFile(file);
				await client.mutation(api.items.add, {
					type: 'image',
					imageKey: key,
					title: file.name
				});
			} finally {
				isAdding = false;
			}
		}
	}
</script>

<div class="container">
	<div class="input-section">
		<div
			class="input-row"
			class:dragging={isDragging}
			ondragover={handleDragOver}
			ondragleave={handleDragLeave}
			ondrop={handleDrop}
			role="region"
			aria-label="File drop zone"
		>
			<textarea
				bind:value={inputValue}
				onkeydown={handleKeydown}
				placeholder="Paste a URL, type text, or drag an image..."
				disabled={isAdding}
				rows="2"
			></textarea>
			<label class="file-input">
				<input type="file" accept="image/*" onchange={handleFileUpload} disabled={isAdding} />
				Upload
			</label>
			<button onclick={handleSubmit} disabled={isAdding || !inputValue.trim()}>Add</button>
		</div>
	</div>

	{#if items.isLoading}
		<p>Loading...</p>
	{:else if items.error}
		<p>Error: {items.error.message}</p>
	{:else if items.data?.length === 0}
		<p>No items yet. Add your first one above!</p>
	{:else}
		<ItemGrid items={items.data ?? []} />
	{/if}
</div>

<style>
	.input-section {
		margin-bottom: 2rem;
	}
	.input-row {
		display: flex;
		gap: 0.5rem;
		align-items: flex-start;
		border: 2px dashed transparent;
		padding: 0.5rem;
		margin: -0.5rem;
		transition: all 0.2s;
	}
	.input-row.dragging {
		border-color: var(--txt-2);
		background: var(--bg-2);
	}
	textarea {
		flex: 1;
		resize: vertical;
	}
	.file-input {
		padding: 0.5rem 1rem;
		background: var(--bg-2);
		border: 1px solid var(--border);
		cursor: pointer;
	}
	.file-input:hover {
		background: var(--bg-3);
	}
	.file-input input {
		display: none;
	}
</style>
