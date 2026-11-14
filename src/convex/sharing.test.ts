// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';
import { hashToken } from './lib/auth';

const modules = import.meta.glob('./**/*.ts');

type Test = ReturnType<typeof convexTest>;

async function makeUser(t: Test, username: string) {
	const token = `${username}-token`;
	await t.run(async (ctx) => {
		const userId = await ctx.db.insert('users', { username, passwordHash: 'unused' });
		await ctx.db.insert('sessions', { userId, tokenHash: await hashToken(token) });
	});
	return token;
}

// Owner with a collection holding one note, which is also in a second, private collection
async function setup() {
	const t = convexTest(schema, modules);
	const owner = await makeUser(t, 'owner');
	const other = await makeUser(t, 'other');
	const collectionId = await t.mutation(api.collections.create, { name: 'refs', token: owner });
	const privateId = await t.mutation(api.collections.create, { name: 'secret', token: owner });
	const itemId = await t.mutation(api.items.add, {
		type: 'text',
		title: 'poster note',
		content: 'hello',
		collections: [collectionId, privateId],
		token: owner
	});
	const share = (shared: boolean) =>
		t.mutation(api.collections.update, { id: collectionId, shared, token: owner });
	return { t, owner, other, collectionId, privateId, itemId, share };
}

describe('shared collections', () => {
	test('private by default: only the owner sees it', async () => {
		const { t, owner, other, collectionId } = await setup();

		const own = await t.query(api.collections.get, { id: collectionId, token: owner });
		expect(own).toMatchObject({ name: 'refs', owner: 'owner', isOwner: true, shared: false });
		expect(await t.query(api.items.listByCollection, { collectionId, token: owner })).toHaveLength(
			1
		);

		for (const token of [other, undefined]) {
			expect(await t.query(api.collections.get, { id: collectionId, token })).toBeNull();
			expect(await t.query(api.items.listByCollection, { collectionId, token })).toEqual([]);
			expect(
				await t.query(api.items.searchCollection, { collectionId, query: 'poster', token })
			).toEqual([]);
		}
	});

	test('shared: anyone can view it, without the owner-only fields', async () => {
		const { t, other, collectionId, share } = await setup();
		await share(true);

		for (const token of [other, undefined, 'ended-session']) {
			const collection = await t.query(api.collections.get, { id: collectionId, token });
			expect(collection).toMatchObject({ name: 'refs', owner: 'owner', isOwner: false });

			const [item] = await t.query(api.items.listByCollection, { collectionId, token });
			expect(item).toMatchObject({ title: 'poster note', collections: [] });
			expect(item.searchText).toBeUndefined();
			expect(item.userId).toBeUndefined();

			const found = await t.query(api.items.searchCollection, {
				collectionId,
				query: 'poster',
				token
			});
			expect(found).toHaveLength(1);
			expect(found[0].collections).toEqual([]);
		}
	});

	test('sharing one collection shows nothing of the others', async () => {
		const { t, other, privateId, share } = await setup();
		await share(true);

		expect(await t.query(api.collections.get, { id: privateId, token: other })).toBeNull();
		expect(
			await t.query(api.items.listByCollection, { collectionId: privateId, token: other })
		).toEqual([]);
	});

	test("searching a shared collection skips the owner's matches elsewhere", async () => {
		const { t, owner, other, collectionId, privateId, share } = await setup();
		await share(true);
		await t.mutation(api.items.add, {
			type: 'text',
			title: 'poster draft',
			content: 'private',
			collections: [privateId],
			token: owner
		});

		const found = await t.query(api.items.searchCollection, {
			collectionId,
			query: 'poster',
			token: other
		});
		expect(found.map((item) => item.title)).toEqual(['poster note']);
	});

	test('unsharing cuts visitors off and only the owner can share', async () => {
		const { t, other, collectionId, share } = await setup();
		await share(true);
		await share(false);
		expect(await t.query(api.collections.get, { id: collectionId })).toBeNull();

		await expect(
			t.mutation(api.collections.update, { id: collectionId, shared: true, token: other })
		).rejects.toThrow('collection not found');
	});

	test('a malformed id from the URL is just not found', async () => {
		const { t } = await setup();
		expect(await t.query(api.collections.get, { id: 'not-an-id' })).toBeNull();
	});

	test('item links must be http(s)', async () => {
		const { t, owner, itemId } = await setup();
		await expect(
			t.mutation(api.items.add, { type: 'url', url: 'javascript:alert(1)', token: owner })
		).rejects.toThrow('http');
		await expect(
			t.mutation(api.items.update, { id: itemId, url: 'data:text/html,hi', token: owner })
		).rejects.toThrow('http');
		await t.mutation(api.items.update, { id: itemId, url: '', token: owner });
	});
});
