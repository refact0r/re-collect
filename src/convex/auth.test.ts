// @vitest-environment edge-runtime
import { afterEach, describe, expect, test, vi } from 'vitest';
import { api, internal } from './_generated/api';
import { listItems, makeUser, newTest, type Test } from './testing.helpers';

// For tests that add items: their scheduled tagging and embedding runs never start
function itemTest() {
	vi.useFakeTimers();
	return newTest();
}

afterEach(() => {
	vi.useRealTimers();
});

async function invite(t: Test) {
	const { code } = await t.action(internal.users.invite, {});
	return code;
}

async function signup(t: Test, username: string, password: string) {
	return await t.action(api.sessions.signup, { invite: await invite(t), username, password });
}

async function setAttempts(t: Test, username: string, count: number, lastAttempt: number) {
	await t.run((ctx) => ctx.db.insert('loginAttempts', { username, count, lastAttempt }));
}

async function attemptsFor(t: Test, username: string) {
	return await t.run((ctx) =>
		ctx.db
			.query('loginAttempts')
			.withIndex('by_username', (q) => q.eq('username', username))
			.unique()
	);
}

// The error each login rejects with, or 'ok'
async function tryLogins(t: Test, username: string, password: string, times: number) {
	const messages = [];
	for (let i = 0; i < times; i++) {
		messages.push(
			await t.action(api.sessions.login, { username, password }).then(
				() => 'ok',
				(error) => String(error.data)
			)
		);
	}
	return messages;
}

const HOUR = 60 * 60 * 1000;

describe('per-user isolation', () => {
	test("another user's items and collections look missing", async () => {
		const t = itemTest();
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

		expect(await listItems(t, b.token)).toEqual([]);
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
		const t = itemTest();
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
		const t = newTest();
		await expect(listItems(t, 'nope')).rejects.toThrow('Unauthorized');
	});
});

describe('uploads', () => {
	test('an image key must be the caller’s own unused upload', async () => {
		const t = itemTest();
		const a = await makeUser(t, 'a');
		const b = await makeUser(t, 'b');
		await t.run((ctx) =>
			ctx.db.insert('uploads', { userId: a.userId, key: 'a-key', verifiedType: 'image/png' })
		);

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
	});
});

describe('accounts and sessions', () => {
	test('invites are single-use', async () => {
		const t = newTest();
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
		const t = newTest();
		await signup(t, 'sam', 'correct horse');
		// One attempt left before the lockout
		await setAttempts(t, 'sam', 9, Date.now());

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

	test('a made-up username fails and locks exactly like a real one', async () => {
		const t = newTest();
		await signup(t, 'sam', 'correct horse');

		const real = await tryLogins(t, 'Sam', 'wrong guess', 11);
		const fake = await tryLogins(t, 'nobody', 'wrong guess', 11);
		expect(real).toEqual([
			...Array(10).fill('wrong username or password'),
			'too many attempts, try again later'
		]);
		expect(fake).toEqual(real);
		expect(await attemptsFor(t, 'nobody')).toMatchObject({ count: 10 });
	});

	test('a successful login clears the count', async () => {
		const t = newTest();
		await signup(t, 'sam', 'correct horse');
		await setAttempts(t, 'sam', 9, Date.now());

		expect(await tryLogins(t, 'sam', 'correct horse', 1)).toEqual(['ok']);
		expect(await attemptsFor(t, 'sam')).toBeNull();
	});

	test('a wrong current password counts, and a password change clears the count', async () => {
		const t = newTest();
		const token = await signup(t, 'sam', 'correct horse');

		await expect(
			t.action(api.sessions.changePassword, {
				token,
				currentPassword: 'wrong guess',
				newPassword: 'battery staple'
			})
		).rejects.toThrow('current password is wrong');
		expect(await attemptsFor(t, 'sam')).toMatchObject({ count: 1 });

		await t.action(api.sessions.changePassword, {
			token,
			currentPassword: 'correct horse',
			newPassword: 'battery staple'
		});
		expect(await attemptsFor(t, 'sam')).toBeNull();
	});

	test('setting a password from the CLI clears the count', async () => {
		const t = newTest();
		await signup(t, 'sam', 'correct horse');
		await setAttempts(t, 'sam', 10, Date.now());

		await t.action(internal.users.setPassword, { username: 'sam', password: 'battery staple' });
		expect(await attemptsFor(t, 'sam')).toBeNull();
	});

	test('once locked, a name gets one attempt per lockout window', async () => {
		const t = newTest();
		await setAttempts(t, 'nobody', 10, Date.now() - 20 * 60 * 1000);

		expect(await tryLogins(t, 'nobody', 'wrong guess', 2)).toEqual([
			'wrong username or password',
			'too many attempts, try again later'
		]);
	});

	test('a count is forgotten a day after its last attempt', async () => {
		const t = newTest();
		await signup(t, 'sam', 'correct horse');
		await setAttempts(t, 'sam', 10, Date.now() - 25 * HOUR);
		await setAttempts(t, 'nobody', 10, Date.now() - 25 * HOUR);

		expect(await tryLogins(t, 'sam', 'correct horse', 1)).toEqual(['ok']);
		expect(await tryLogins(t, 'nobody', 'wrong guess', 1)).toEqual(['wrong username or password']);
		expect(await attemptsFor(t, 'nobody')).toMatchObject({ count: 1 });
	});

	test('the sweep deletes only counts older than a day', async () => {
		const t = newTest();
		await setAttempts(t, 'old', 3, Date.now() - 25 * HOUR);
		await setAttempts(t, 'recent', 3, Date.now() - HOUR);

		await t.mutation(internal.sessions.sweepLoginAttempts, {});
		expect(await attemptsFor(t, 'old')).toBeNull();
		expect(await attemptsFor(t, 'recent')).toMatchObject({ count: 3 });
	});

	test('an over-long username is refused without storing it', async () => {
		const t = newTest();
		const long = 'x'.repeat(33);
		expect(await tryLogins(t, long, 'wrong guess', 1)).toEqual(['wrong username or password']);
		expect(await attemptsFor(t, long)).toBeNull();
	});

	test('signup without a valid invite never says whether a username is taken', async () => {
		const t = newTest();
		await signup(t, 'sam', 'correct horse');

		await expect(
			t.action(api.sessions.signup, { invite: 'bogus', username: 'sam', password: 'password1' })
		).rejects.toThrow('invalid or already used');
		await expect(signup(t, 'sam', 'password1')).rejects.toThrow('that username is taken');
	});

	test('a new extension token replaces the old one', async () => {
		const t = newTest();
		const a = await makeUser(t, 'a');
		const first = await t.action(api.sessions.createExtensionToken, { token: a.token });
		const second = await t.action(api.sessions.createExtensionToken, { token: a.token });

		await expect(t.query(api.users.me, { token: first })).rejects.toThrow('Unauthorized');
		expect(await t.query(api.users.me, { token: second })).toEqual({ username: 'a' });
		expect(await t.query(api.users.me, { token: a.token })).toEqual({ username: 'a' });
	});

	test('signing out other devices keeps only the caller', async () => {
		const t = newTest();
		const a = await makeUser(t, 'a');
		const b = await makeUser(t, 'b');
		const extension = await t.action(api.sessions.createExtensionToken, { token: a.token });

		await t.mutation(api.sessions.signOutOthers, { token: a.token });

		await expect(t.query(api.users.me, { token: extension })).rejects.toThrow('Unauthorized');
		expect(await t.query(api.users.me, { token: a.token })).toEqual({ username: 'a' });
		expect(await t.query(api.users.me, { token: b.token })).toEqual({ username: 'b' });
	});
});
