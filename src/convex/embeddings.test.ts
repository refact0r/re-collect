// @vitest-environment edge-runtime
import { afterEach, expect, test, vi } from 'vitest';
import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { hashToken } from './lib/auth';
import { r2 } from './r2';
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, documentText, inputKey } from './lib/embedder';
import { newTest, type Test } from './testing.helpers';

const vector = (x: number) => Array.from({ length: EMBEDDING_DIMENSIONS }, () => x);
const NOTE = { title: 'note', content: 'risograph' };
// The key of what the test note embeds as
const noteKey = () => inputKey({ kind: 'text', text: documentText(NOTE) });

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

async function setup() {
	vi.useFakeTimers(); // Queued embedding runs start only when a test drains them
	const t = newTest();
	const token = 'a-token';
	const { userId, itemId } = await t.run(async (ctx) => {
		const userId = await ctx.db.insert('users', { username: 'a', passwordHash: 'unused' });
		await ctx.db.insert('sessions', { userId, tokenHash: await hashToken(token) });
		const itemId = await ctx.db.insert('items', {
			userId,
			type: 'text',
			...NOTE,
			collections: [],
			dateAdded: 0,
			dateModified: 0
		});
		return { userId, itemId };
	});
	const rows = (id: Id<'items'> = itemId) =>
		t.run((ctx) =>
			ctx.db
				.query('itemEmbeddings')
				.withIndex('by_item', (q) => q.eq('itemId', id))
				.collect()
		);
	// The map's two documents, as stored
	const mapDocs = () =>
		t.run(async (ctx) => ({
			state: await ctx.db
				.query('embeddingMapStates')
				.withIndex('by_user', (q) => q.eq('userId', userId))
				.unique(),
			layout: await ctx.db
				.query('embeddingMapLayouts')
				.withIndex('by_user', (q) => q.eq('userId', userId))
				.unique()
		}));
	return { t, token, userId, itemId, rows, mapDocs };
}

const imageItem = (t: Test, userId: Id<'users'>, imageKey = 'a.jpg') =>
	t.run((ctx) =>
		ctx.db.insert('items', {
			userId,
			type: 'image',
			imageKey,
			collections: [],
			dateAdded: 0,
			dateModified: 0
		})
	);

// Workers AI, answering each call in turn with the given statuses (200 is a vector)
function stubWorkersAi(...statuses: number[]) {
	vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'account');
	vi.stubEnv('CLOUDFLARE_API_TOKEN', 'token');
	const fetch = vi.fn(async () => {
		const status = statuses.shift() ?? 200;
		return status === 200
			? Response.json({ result: { data: [{ embedding: vector(1) }] } })
			: new Response('nope', { status });
	});
	vi.stubGlobal('fetch', fetch);
	vi.spyOn(console, 'error').mockImplementation(() => {});
	return fetch;
}

test('saving an embedding replaces the item’s previous one', async () => {
	const { t, userId, itemId, rows } = await setup();
	const key = await noteKey();
	await t.mutation(internal.embeddings.saveEmbedding, {
		itemId,
		inputKey: key,
		embedding: vector(0.1)
	});
	await t.mutation(internal.embeddings.saveEmbedding, {
		itemId,
		inputKey: key,
		embedding: vector(0.2)
	});
	const saved = await rows();
	expect(saved).toHaveLength(1);
	expect(saved[0]).toMatchObject({ userId, model: EMBEDDING_MODEL, inputKey: key });
	expect(saved[0].embedding[0]).toBe(0.2);

	const found = await t.query(internal.embeddings.getItemForEmbedding, { itemId });
	expect(found?.embeddedKey).toBe(key);
});

test('a run that read an older version of the item doesn’t save', async () => {
	const { t, itemId, rows } = await setup();
	await t.mutation(internal.embeddings.saveEmbedding, {
		itemId,
		inputKey: await inputKey({ kind: 'text', text: 'title: note | text: an older draft' }),
		embedding: vector(0.1)
	});
	expect(await rows()).toHaveLength(0);
});

test('deleting an item deletes its embedding, and a late save is dropped', async () => {
	const { t, token, itemId, rows } = await setup();
	const save = async () =>
		t.mutation(internal.embeddings.saveEmbedding, {
			itemId,
			inputKey: await noteKey(),
			embedding: vector(0.1)
		});
	await save();
	expect(await rows()).toHaveLength(1);
	await t.mutation(api.items.remove, { id: itemId, token });
	expect(await rows()).toHaveLength(0);

	await save();
	expect(await rows()).toHaveLength(0);
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

test('a queued run retries a rate limit and embeds', async () => {
	const { t, itemId, rows } = await setup();
	const fetch = stubWorkersAi(429, 503);
	await t.mutation(internal.embeddings.backfill, {});
	await t.finishAllScheduledFunctions(vi.runAllTimers);
	expect(fetch).toHaveBeenCalledTimes(3);
	expect(await rows()).toMatchObject([{ itemId, inputKey: await noteKey() }]);
});

test('a queued run gives up on a rejected request without retrying', async () => {
	const { t, rows } = await setup();
	const fetch = stubWorkersAi(400);
	await t.mutation(internal.embeddings.backfill, {});
	await t.finishAllScheduledFunctions(vi.runAllTimers);
	expect(fetch).toHaveBeenCalledOnce();
	expect(await rows()).toHaveLength(0);
});

test('a retry doesn’t send an item turned off since the failed attempt', async () => {
	const { t, itemId, rows } = await setup();
	const fetch = stubWorkersAi(503);
	fetch.mockImplementationOnce(async () => {
		await t.run((ctx) => ctx.db.patch(itemId, { taggingMode: 'none' }));
		return new Response('busy', { status: 503 });
	});
	await t.mutation(internal.embeddings.backfill, {});
	await t.finishAllScheduledFunctions(vi.runAllTimers);
	expect(fetch).toHaveBeenCalledOnce();
	expect(await rows()).toHaveLength(0);
});

test('image embedding writes mark the map stale and leave its layout alone; text ones touch neither', async () => {
	const { t, token, userId, itemId, mapDocs } = await setup();
	const image = await imageItem(t, userId);
	const save = async (id: Id<'items'>, key: string) =>
		t.mutation(internal.embeddings.saveEmbedding, {
			itemId: id,
			inputKey: key,
			embedding: vector(0.1)
		});
	const imageKey = await inputKey({ kind: 'image', imageKey: 'a.jpg' });

	// Before the first layout there's only a state, and no map to show
	await save(image, imageKey);
	expect(await mapDocs()).toMatchObject({ state: { version: 1, layoutVersion: 0 }, layout: null });
	expect(await t.query(api.embeddingMap.get, { token })).toBeNull();

	await t.mutation(internal.embeddingMap.save, {
		userId,
		model: EMBEDDING_MODEL,
		points: [{ itemId: image, x: 0, y: 0 }],
		layoutVersion: 1
	});
	const laidOut = await mapDocs();
	expect(laidOut.state).toMatchObject({ version: 1, layoutVersion: 1 });
	expect(await t.query(api.embeddingMap.get, { token })).toEqual({
		points: [{ itemId: image, x: 0, y: 0 }]
	});

	await save(itemId, await noteKey());
	expect(await mapDocs()).toEqual(laidOut);

	await save(image, imageKey);
	const after = await mapDocs();
	expect(after.state).toMatchObject({ version: 2, layoutVersion: 1 });
	expect(after.layout).toEqual(laidOut.layout);
});

test('only image embedding writes mark the library map stale', async () => {
	const { t, itemId, rows, mapDocs } = await setup();
	const version = async () => (await mapDocs()).state?.version ?? 0;
	const save = (inputKey: string) =>
		t.mutation(internal.embeddings.saveEmbedding, { itemId, inputKey, embedding: vector(0.1) });

	await save(await noteKey());
	expect(await version()).toBe(0);

	// The note becomes an image, then a note again
	const imageKey = await inputKey({ kind: 'image', imageKey: 'a.jpg' });
	await t.run((ctx) => ctx.db.patch(itemId, { type: 'image', imageKey: 'a.jpg' }));
	await save(imageKey);
	expect(await version()).toBe(1);
	await t.run((ctx) => ctx.db.patch(itemId, { type: 'text', imageKey: undefined }));
	await save(await noteKey());
	expect(await version()).toBe(2);
	expect(await rows()).toHaveLength(1);
});

test('refresh lays a stale map out, a change made mid-layout leaves it stale, and a fresh one is left alone', async () => {
	const { t, token, userId, mapDocs } = await setup();
	const images = [await imageItem(t, userId, 'a.jpg'), await imageItem(t, userId, 'b.jpg')];
	for (const [i, id] of images.entries()) {
		await t.mutation(internal.embeddings.saveEmbedding, {
			itemId: id,
			inputKey: await inputKey({ kind: 'image', imageKey: i ? 'b.jpg' : 'a.jpg' }),
			embedding: vector(i + 1)
		});
	}

	expect(await t.action(api.embeddingMapActions.refresh, { token })).toBe(true);
	const laidOut = await mapDocs();
	expect(laidOut.state).toMatchObject({ model: EMBEDDING_MODEL, version: 2, layoutVersion: 2 });
	expect(laidOut.layout?.points.map((p) => p.itemId).sort()).toEqual([...images].sort());

	expect(await t.action(api.embeddingMapActions.refresh, { token })).toBe(false);
	expect(await mapDocs()).toEqual(laidOut);

	// A save that lands while a layout runs leaves it stale
	await t.mutation(internal.embeddings.saveEmbedding, {
		itemId: images[0],
		inputKey: await inputKey({ kind: 'image', imageKey: 'a.jpg' }),
		embedding: vector(3)
	});
	await t.mutation(internal.embeddingMap.save, {
		userId,
		model: EMBEDDING_MODEL,
		points: laidOut.layout!.points,
		layoutVersion: 2
	});
	expect((await mapDocs()).state).toMatchObject({ version: 3, layoutVersion: 2 });
	expect(await t.action(api.embeddingMapActions.refresh, { token })).toBe(true);
	expect((await mapDocs()).state).toMatchObject({ version: 3, layoutVersion: 3 });

	// Deleting an item with an image embedding marks it stale again
	vi.spyOn(r2, 'deleteObject').mockResolvedValue();
	await t.mutation(api.items.remove, { id: images[1], token });
	expect((await mapDocs()).state).toMatchObject({ version: 4, layoutVersion: 3 });
});

test('a layout started before the stored one doesn’t replace it', async () => {
	const { t, userId, itemId, mapDocs } = await setup();
	const layout = (layoutVersion: number, x: number) =>
		t.mutation(internal.embeddingMap.save, {
			userId,
			model: EMBEDDING_MODEL,
			points: [{ itemId, x, y: 0 }],
			layoutVersion
		});
	await layout(6, 1);
	await layout(5, 2);
	expect(await mapDocs()).toMatchObject({
		state: { layoutVersion: 6 },
		layout: { points: [{ x: 1 }] }
	});
});

test('the backfill re-embeds items whose embedding is out of date, and only those', async () => {
	const { t, userId, itemId, rows } = await setup();
	await t.mutation(internal.embeddings.saveEmbedding, {
		itemId,
		inputKey: await noteKey(),
		embedding: vector(0.1)
	});
	// A note edited since its embedding (its re-embed failed, say)
	const edited = await t.run(async (ctx) => {
		const id = await ctx.db.insert('items', {
			userId,
			type: 'text',
			title: 'note',
			content: 'letterpress',
			collections: [],
			dateAdded: 0,
			dateModified: 0
		});
		await ctx.db.insert('itemEmbeddings', {
			itemId: id,
			userId,
			model: EMBEDDING_MODEL,
			inputKey: await noteKey(),
			embedding: vector(0.1)
		});
		return id;
	});

	const fetch = stubWorkersAi();
	await t.mutation(internal.embeddings.backfill, {});
	await t.finishAllScheduledFunctions(vi.runAllTimers);
	expect(fetch).toHaveBeenCalledOnce();
	expect((await rows(edited))[0].inputKey).not.toBe(await noteKey());
});
