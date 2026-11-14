// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { expect, test, vi } from 'vitest';
import { api, internal } from './_generated/api';
import schema from './schema';
import { hashToken } from './lib/auth';
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from './lib/embedder';

const modules = import.meta.glob('./**/*.ts');
const vector = (x: number) => Array.from({ length: EMBEDDING_DIMENSIONS }, () => x);

async function setup() {
	const t = convexTest(schema, modules);
	const token = 'a-token';
	const { userId, itemId } = await t.run(async (ctx) => {
		const userId = await ctx.db.insert('users', { username: 'a', passwordHash: 'unused' });
		await ctx.db.insert('sessions', { userId, tokenHash: await hashToken(token) });
		const itemId = await ctx.db.insert('items', {
			userId,
			type: 'text',
			title: 'note',
			content: 'risograph',
			collections: [],
			dateAdded: 0,
			dateModified: 0
		});
		return { userId, itemId };
	});
	const rows = () =>
		t.run((ctx) =>
			ctx.db
				.query('itemEmbeddings')
				.withIndex('by_item', (q) => q.eq('itemId', itemId))
				.collect()
		);
	return { t, token, userId, itemId, rows };
}

test('saving an embedding replaces the item’s previous one', async () => {
	const { t, userId, itemId, rows } = await setup();
	await t.mutation(internal.embeddings.saveEmbedding, {
		itemId,
		inputKey: 'text:old',
		embedding: vector(0.1)
	});
	await t.mutation(internal.embeddings.saveEmbedding, {
		itemId,
		inputKey: 'text:new',
		embedding: vector(0.2)
	});
	const saved = await rows();
	expect(saved).toHaveLength(1);
	expect(saved[0]).toMatchObject({ userId, model: EMBEDDING_MODEL, inputKey: 'text:new' });

	const found = await t.query(internal.embeddings.getItemForEmbedding, { itemId });
	expect(found?.embeddedKey).toBe('text:new');
});

test('deleting an item deletes its embedding, and a late save is dropped', async () => {
	vi.useFakeTimers(); // Keep the scheduled embedding run from calling out
	const { t, token, itemId, rows } = await setup();
	await t.mutation(internal.embeddings.saveEmbedding, {
		itemId,
		inputKey: 'text:a',
		embedding: vector(0.1)
	});
	await t.mutation(api.items.remove, { id: itemId, token });
	expect(await rows()).toHaveLength(0);

	await t.mutation(internal.embeddings.saveEmbedding, {
		itemId,
		inputKey: 'text:a',
		embedding: vector(0.1)
	});
	expect(await rows()).toHaveLength(0);
	vi.useRealTimers();
});

test('a stale model’s row doesn’t count as embedded', async () => {
	const { t, userId, itemId } = await setup();
	await t.run((ctx) =>
		ctx.db.insert('itemEmbeddings', {
			itemId,
			userId,
			model: 'some/older-model',
			inputKey: 'text:a',
			embedding: vector(0.1)
		})
	);
	const found = await t.query(internal.embeddings.getItemForEmbedding, { itemId });
	expect(found?.embeddedKey).toBeNull();
});
