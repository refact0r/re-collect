<script lang="ts">
	import { useQuery, useConvexClient } from 'convex-svelte';
	import { api } from '../convex/_generated/api.js';
	import type { Id } from '../convex/_generated/dataModel.js';

	const client = useConvexClient();
	const items = useQuery(api.items.list, {});

	let inputValue = $state('');
	let isAdding = $state(false);

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
					url: value,
					title: value
				});
			} else {
				await client.mutation(api.items.add, {
					type: 'text',
					content: value,
					title: value.slice(0, 50)
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
			const uploadUrl = await client.mutation(api.items.generateUploadUrl, {});
			const response = await fetch(uploadUrl, {
				method: 'POST',
				headers: { 'Content-Type': file.type },
				body: file
			});
			const { storageId } = await response.json();

			await client.mutation(api.items.add, {
				type: 'image',
				imageId: storageId,
				title: file.name
			});
			input.value = '';
		} finally {
			isAdding = false;
		}
	}

	async function handleDelete(id: Id<'items'>) {
		if (confirm('Delete this item?')) {
			await client.mutation(api.items.remove, { id });
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			handleSubmit();
		}
	}
</script>

<div class="container">
	<div class="input-section">
		<div class="input-row">
			<textarea
				bind:value={inputValue}
				onkeydown={handleKeydown}
				placeholder="Paste a URL or type text..."
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
		<div class="grid">
			{#each items.data ?? [] as item (item._id)}
				<div class="card">
					{#if item.type === 'image' && item.imageUrl}
						<img src={item.imageUrl} alt={item.title ?? 'Image'} />
					{:else if item.type === 'url'}
						<div class="url-card">
							<a href={item.url} target="_blank" rel="noopener">{item.url}</a>
						</div>
					{:else if item.type === 'text'}
						<div class="text-card">
							<p>{item.content}</p>
						</div>
					{/if}
					{#if item.title}
						<div class="card-title">{item.title}</div>
					{/if}
					<div class="card-actions">
						<a href="/item/{item._id}">edit</a>
						<button onclick={() => handleDelete(item._id)}>delete</button>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.container {
		max-width: 1200px;
		margin: 0 auto;
	}
	.input-section {
		margin-bottom: 2rem;
	}
	.input-row {
		display: flex;
		gap: 0.5rem;
		align-items: flex-start;
	}
	textarea {
		flex: 1;
		padding: 0.5rem;
		font-size: 1rem;
		resize: vertical;
	}
	.file-input {
		padding: 0.5rem 1rem;
		background: #eee;
		cursor: pointer;
	}
	.file-input input {
		display: none;
	}
	button {
		padding: 0.5rem 1rem;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
		gap: 1rem;
	}
	.card {
		border: 1px solid #ddd;
		padding: 0.5rem;
		break-inside: avoid;
	}
	.card img {
		width: 100%;
		display: block;
	}
	.url-card,
	.text-card {
		padding: 1rem;
		background: #f9f9f9;
		word-break: break-all;
	}
	.card-title {
		padding: 0.5rem 0;
		font-size: 0.875rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.card-actions {
		display: flex;
		gap: 0.5rem;
		font-size: 0.875rem;
	}
	.card-actions button {
		background: none;
		border: none;
		padding: 0;
		text-decoration: underline;
		font-size: inherit;
	}
</style>
