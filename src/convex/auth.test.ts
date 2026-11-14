// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import workpool from '@convex-dev/workpool/test';
import { describe, expect, test, vi } from 'vitest';
import { api, internal } from './_generated/api';
import schema from './schema';
import { hashToken } from './lib/auth';

const modules = import.meta.glob('./**/*.ts');

type Test = ReturnType<typeof convexTest>;

// A user with one session, skipping the slow password hash
async function makeUser(t: Test, username: string) {
	const token = `${username}-token`;
	const userId = await t.run(async (ctx) => {
		const userId = await ctx.db.insert('users', { username, passwordHash: 'unused' });
		await ctx.db.insert('sessions', { userId, tokenHash: await hashToken(token) });
		return userId;
	});
	return { userId, token };
}

async function invite(t: Test) {
	const { code } = await t.action(internal.users.invite, {});
	return code;
}

describe('per-user isolation', () => {
	test("another user's items and collections look missing", async () => {
		const t = convexTest(schema, modules);
		const a = await makeUser(t, 'a');
		const b = await makeUser(t, 'b');

		const collectionId = await t.mutation(api.collections.create, {
			name: 'mine',
			token: a.token
		});
		const itemId = await t.mutation(api.items.add, {
			type: 'text',
			content: 'secret note',
			title: 'secret',
			collections: [collectionId],
			token: a.token
		});

		expect(await t.query(api.items.list, { token: b.token })).toEqual([]);
		expect(await t.query(api.collections.listWithCounts, { token: b.token })).toEqual([]);
		expect(await t.query(api.items.search, { query: 'secret', token: b.token })).toEqual([]);
		expect(await t.query(api.items.listByCollection, { collectionId, token: b.token })).toEqual([]);
		expect(await t.query(api.items.search, { query: 'secret', token: a.token })).toHaveLength(1);

		await expect(
			t.mutation(api.items.update, { id: itemId, title: 'x', token: b.token })
		).rejects.toThrow('item not found');
		await expect(t.mutation(api.items.remove, { id: itemId, token: b.token })).rejects.toThrow(
			'item not found'
		);
		await expect(
			t.mutation(api.collections.remove, { id: collectionId, token: b.token })
		).rejects.toThrow('collection not found');
	});

	test("items can't join another user's collection", async () => {
		const t = convexTest(schema, modules);
		const a = await makeUser(t, 'a');
		const b = await makeUser(t, 'b');
		const collectionId = await t.mutation(api.collections.create, {
			name: 'mine',
			token: a.token
		});

		await expect(
			t.mutation(api.items.add, {
				type: 'text',
				content: 'x',
				collections: [collectionId],
				token: b.token
			})
		).rejects.toThrow('collection not found');

		const itemId = await t.mutation(api.items.add, { type: 'text', content: 'x', token: b.token });
		await expect(
			t.mutation(api.items.addToCollection, { itemId, collectionId, token: b.token })
		).rejects.toThrow('collection not found');
	});

	test('an unknown token is rejected', async () => {
		const t = convexTest(schema, modules);
		await expect(t.query(api.items.list, { token: 'nope' })).rejects.toThrow('Unauthorized');
	});
});

describe('uploads', () => {
	test('an image key must be the caller’s own unused upload', async () => {
		vi.useFakeTimers(); // Keep the scheduled tagging action from running
		const t = convexTest(schema, modules);
		workpool.register(t, 'taggingPool');
		const a = await makeUser(t, 'a');
		const b = await makeUser(t, 'b');
		await t.run((ctx) => ctx.db.insert('uploads', { userId: a.userId, key: 'a-key' }));

		await expect(
			t.mutation(api.items.add, { type: 'image', imageKey: 'a-key', token: b.token })
		).rejects.toThrow('upload not found');
		await expect(
			t.mutation(api.items.add, { type: 'text', content: 'hi', imageKey: 'a-key', token: a.token })
		).rejects.toThrow('upload not found');

		// URL items may carry their own screenshot (the browser extension's)
		await t.mutation(api.items.add, {
			type: 'url',
			url: 'https://example.com',
			imageKey: 'a-key',
			token: a.token
		});
		await expect(
			t.mutation(api.items.add, { type: 'image', imageKey: 'a-key', token: a.token })
		).rejects.toThrow('upload not found');
		vi.useRealTimers();
	});
});

describe('accounts and sessions', () => {
	test('invites are single-use', async () => {
		const t = convexTest(schema, modules);
		const code = await invite(t);
		const token = await t.action(api.sessions.signup, {
			invite: code,
			username: 'Sam',
			password: 'correct horse'
		});
		expect(await t.query(api.users.me, { token })).toEqual({ username: 'sam' });

		await expect(
			t.action(api.sessions.signup, { invite: code, username: 'other', password: 'password1' })
		).rejects.toThrow('invalid or already used');
	});

	test('parallel guesses past the limit are locked out', async () => {
		const t = convexTest(schema, modules);
		await t.action(api.sessions.signup, {
			invite: await invite(t),
			username: 'sam',
			password: 'correct horse'
		});
		// One attempt left before the lockout
		await t.run(async (ctx) => {
			const user = await ctx.db.query('users').first();
			await ctx.db.patch(user!._id, { failedLogins: 9, lastFailedLogin: Date.now() });
		});

		const results = await Promise.allSettled(
			[1, 2, 3].map(() =>
				t.action(api.sessions.login, { username: 'sam', password: 'wrong guess' })
			)
		);
		const messages = results.map((r) => r.status === 'rejected' && String(r.reason.message));
		expect(messages.filter((m) => m && m.includes('wrong username'))).toHaveLength(1);
		expect(messages.filter((m) => m && m.includes('too many attempts'))).toHaveLength(2);

		await expect(
			t.action(api.sessions.login, { username: 'sam', password: 'correct horse' })
		).rejects.toThrow('too many attempts');
	});

	test('a new extension token replaces the old one', async () => {
		const t = convexTest(schema, modules);
		const a = await makeUser(t, 'a');
		const first = await t.action(api.sessions.createExtensionToken, { token: a.token });
		const second = await t.action(api.sessions.createExtensionToken, { token: a.token });

		await expect(t.query(api.users.me, { token: first })).rejects.toThrow('Unauthorized');
		expect(await t.query(api.users.me, { token: second })).toEqual({ username: 'a' });
		expect(await t.query(api.users.me, { token: a.token })).toEqual({ username: 'a' });
	});

	test('signing out other devices keeps only the caller', async () => {
		const t = convexTest(schema, modules);
		const a = await makeUser(t, 'a');
		const b = await makeUser(t, 'b');
		const extension = await t.action(api.sessions.createExtensionToken, { token: a.token });

		await t.mutation(api.sessions.signOutOthers, { token: a.token });

		await expect(t.query(api.users.me, { token: extension })).rejects.toThrow('Unauthorized');
		expect(await t.query(api.users.me, { token: a.token })).toEqual({ username: 'a' });
		expect(await t.query(api.users.me, { token: b.token })).toEqual({ username: 'b' });
	});
});
