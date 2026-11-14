// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { generateKeyBetween } from 'fractional-indexing';
import workpool from '@convex-dev/workpool/test';
import { expect, test, vi } from 'vitest';
import { api, internal } from './_generated/api';
import schema from './schema';
import type { Id } from './_generated/dataModel';
import { hashToken } from './lib/auth';

const modules = import.meta.glob('./**/*.ts');

test('per-save overrides replace the collection’s ingestion defaults', async () => {
	vi.useFakeTimers(); // Keep the scheduled tagging actions from running
	const t = convexTest(schema, modules);
	workpool.register(t, 'taggingPool');
	const token = 'a-token';
	const userId = await t.run(async (ctx) => {
		const userId = await ctx.db.insert('users', { username: 'a', passwordHash: 'unused' });
		await ctx.db.insert('sessions', { userId, tokenHash: await hashToken(token) });
		await ctx.db.insert('uploads', { userId, key: 'key-1' });
		await ctx.db.insert('uploads', { userId, key: 'key-2' });
		return userId;
	});
	const collectionId = await t.mutation(api.collections.create, {
		name: 'untagged',
		taggingMode: 'none',
		token
	});

	// URL items with their own image skip the worker, so nothing gets enqueued
	const add = (imageKey: string, overrides = {}) =>
		t.mutation(api.items.add, {
			type: 'url',
			url: 'https://example.com',
			imageKey,
			collections: [collectionId],
			token,
			...overrides
		});
	const defaulted = await add('key-1');
	const overridden = await add('key-2', { taggingMode: 'visual', linkImageMode: 'og' });

	const [a, b] = await t.run((ctx) => Promise.all([ctx.db.get(defaulted), ctx.db.get(overridden)]));
	expect(a).toMatchObject({ userId, taggingMode: 'none' });
	expect(a?.taggingStatus).toBeUndefined();
	expect(b).toMatchObject({ taggingMode: 'visual', linkImageMode: 'og', taggingStatus: 'pending' });
	vi.useRealTimers();
});

test('captured fonts are stored, searchable, and kept when a capture brings none', async () => {
	vi.useFakeTimers(); // Keep the scheduled palette/tagging actions from running
	const t = convexTest(schema, modules);
	const itemId = await t.run(async (ctx) => {
		const userId = await ctx.db.insert('users', { username: 'a', passwordHash: 'unused' });
		return ctx.db.insert('items', {
			userId,
			type: 'url',
			url: 'https://klim.co.nz',
			taggingMode: 'none',
			collections: [],
			dateAdded: 0,
			dateModified: 0
		});
	});
	const complete = (fonts?: { family: string; internalName?: string }[]) =>
		t.mutation(internal.screenshots.setCompleted, {
			itemId,
			imageKey: 'screenshots/klim.webp',
			imageWidth: 1440,
			imageHeight: 900,
			fonts
		});

	await complete([{ family: 'SOEHNE', internalName: 'Söhne' }]);
	await complete(); // og fast path: no browser, no fonts
	const item = await t.run((ctx) => ctx.db.get(itemId));
	expect(item?.fonts).toEqual([{ family: 'SOEHNE', internalName: 'Söhne' }]);
	expect(item?.searchText?.toLowerCase()).toContain('soehne');
	vi.useRealTimers();
});

// A user with one session, skipping the slow password hash
async function makeUser(t: ReturnType<typeof convexTest>) {
	const token = 'a-token';
	const userId = await t.run(async (ctx) => {
		const userId = await ctx.db.insert('users', { username: 'a', passwordHash: 'unused' });
		await ctx.db.insert('sessions', { userId, tokenHash: await hashToken(token) });
		return userId;
	});
	return { userId, token };
}

// Inserted directly: items.add would enqueue a screenshot on the workpool component
function insertUrlItem(
	t: ReturnType<typeof convexTest>,
	userId: Id<'users'>,
	fields: { url: string; title?: string; description?: string }
) {
	return t.run((ctx) =>
		ctx.db.insert('items', {
			userId,
			type: 'url',
			...fields,
			collections: [],
			dateAdded: 0,
			dateModified: 0
		})
	);
}

test('only http(s) links become URL items', async () => {
	const t = convexTest(schema, modules);
	const { userId, token } = await makeUser(t);

	for (const url of [
		'note: buy milk tomorrow',
		'mailto:a@b.co',
		'javascript:alert(1)',
		undefined
	]) {
		await expect(t.mutation(api.items.add, { type: 'url', url, token })).rejects.toThrow(
			'only http(s) links can be saved'
		);
	}
	const itemId = await insertUrlItem(t, userId, { url: 'https://a.co' });
	await expect(
		t.mutation(api.items.update, { id: itemId, url: 'file:///etc/hosts', token })
	).rejects.toThrow('only http(s) links can be saved');
	await t.mutation(api.items.update, { id: itemId, url: ' http://b.co ', token });
	expect((await t.run((ctx) => ctx.db.get(itemId)))?.url).toBe('http://b.co');
});

test('update leaves omitted fields alone and clears blank ones', async () => {
	const t = convexTest(schema, modules);
	const { userId, token } = await makeUser(t);
	const itemId = await insertUrlItem(t, userId, {
		url: 'https://b.co',
		title: 'zebra',
		description: 'notes'
	});

	await t.mutation(api.items.update, { id: itemId, title: '  ', token });
	const item = await t.run((ctx) => ctx.db.get(itemId));
	expect(item).not.toHaveProperty('title');
	expect(item).toMatchObject({ url: 'https://b.co', description: 'notes' });
	expect(item?.searchText).toBe('notes https://b.co');
});

test('a stored empty title sorts by url, not first', async () => {
	const t = convexTest(schema, modules);
	const { userId, token } = await makeUser(t);
	const legacy = await insertUrlItem(t, userId, { url: 'https://zine.co', title: '' });
	const titled = await insertUrlItem(t, userId, { url: 'https://b.co', title: 'apple' });

	const items = await t.query(api.items.list, { sortBy: 'titleAsc', token });
	expect(items.map((i) => i._id)).toEqual([titled, legacy]);
});

test('text items are searchable by their content', async () => {
	const t = convexTest(schema, modules);
	const { token } = await makeUser(t);
	const search = async (query: string) =>
		(await t.query(api.items.search, { query, token })).map((i) => i._id);

	const itemId = await t.mutation(api.items.add, {
		type: 'text',
		content: 'risograph paper supplier',
		token
	});
	expect(await search('risograph')).toEqual([itemId]);

	await t.mutation(api.items.update, { id: itemId, content: 'letterpress studio', token });
	expect(await search('risograph')).toEqual([]);
	expect(await search('letterpress')).toEqual([itemId]);
});

test('rebuildSearchText recomputes searchText from current fields', async () => {
	const t = convexTest(schema, modules);
	const itemId = await t.run(async (ctx) => {
		const userId = await ctx.db.insert('users', { username: 'a', passwordHash: 'unused' });
		return ctx.db.insert('items', {
			userId,
			type: 'text',
			content: 'risograph paper supplier',
			searchText: '',
			collections: [],
			dateAdded: 0,
			dateModified: 0
		});
	});
	await t.mutation(internal.items.rebuildSearchText, {});
	const item = await t.run((ctx) => ctx.db.get(itemId));
	expect(item).toMatchObject({ searchText: 'risograph paper supplier', dateModified: 0 });
});

test('deleting a collection drops its memberships without touching members', async () => {
	vi.useFakeTimers();
	const t = convexTest(schema, modules);
	const { token } = await makeUser(t);
	const doomed = await t.mutation(api.collections.create, { name: 'doomed', token });
	const kept = await t.mutation(api.collections.create, { name: 'kept', token });
	const itemIds = await Promise.all(
		['one', 'two'].map((content) =>
			t.mutation(api.items.add, { type: 'text', content, collections: [doomed, kept], token })
		)
	);
	const before = await t.run((ctx) => Promise.all(itemIds.map((id) => ctx.db.get(id))));

	vi.advanceTimersByTime(1000);
	await t.mutation(api.collections.remove, { id: doomed, token });

	await t.run(async (ctx) => {
		for (const [i, id] of itemIds.entries()) {
			const item = await ctx.db.get(id);
			expect(item?.collections).toEqual([kept]);
			expect(item?.dateModified).toBe(before[i]?.dateModified);
		}
		const positions = await ctx.db.query('itemCollectionPositions').collect();
		expect(positions.map((p) => p.collectionId)).toEqual([kept, kept]);
		expect(await ctx.db.get(doomed)).toBeNull();
		expect((await ctx.db.get(kept))?.itemCount).toBe(2);
	});
	vi.useRealTimers();
});

test('collection items keep manual order, which also breaks sort ties', async () => {
	const t = convexTest(schema, modules);
	const { token } = await makeUser(t);
	const collectionId = await t.mutation(api.collections.create, { name: 'c', token });
	const add = (title: string) =>
		t.mutation(api.items.add, { type: 'text', title, collections: [collectionId], token });
	const [a, b, c] = [await add('same'), await add('same'), await add('first')];
	const list = async (sortBy?: 'titleAsc') =>
		(await t.query(api.items.listByCollection, { collectionId, sortBy, token })).map((i) => i._id);

	// New members go on top
	expect(await list()).toEqual([c, b, a]);
	const [top] = await t.query(api.items.listByCollection, { collectionId, token });
	await t.mutation(api.itemCollectionPositions.reorderItem, {
		itemId: a,
		collectionId,
		newPosition: generateKeyBetween(null, top.position),
		token
	});
	expect(await list()).toEqual([a, c, b]);
	expect(await list('titleAsc')).toEqual([c, a, b]);

	await t.mutation(api.items.removeFromCollection, { itemId: a, collectionId, token });
	await expect(
		t.mutation(api.itemCollectionPositions.reorderItem, {
			itemId: a,
			collectionId,
			newPosition: 'a0',
			token
		})
	).rejects.toThrow('item is not in this collection');
});
