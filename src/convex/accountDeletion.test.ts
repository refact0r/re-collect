// @vitest-environment edge-runtime
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { hashToken } from './lib/auth';
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from './lib/embedder';
import { makeUser, newTest, stubR2, type Test } from './testing.helpers';

let deleted: ReturnType<typeof stubR2>;

beforeEach(() => {
	vi.useFakeTimers(); // Scheduled runs (the batches included) start only when a test calls them
	deleted = stubR2();
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

const deletedKeys = () => deleted.mock.calls.map(([, key]) => key);

async function signup(t: Test, username: string, password: string) {
	const { code } = await t.action(internal.users.invite, {});
	return await t.action(api.sessions.signup, { invite: code, username, password });
}

const userIdFor = (t: Test, token: string) =>
	t.query(internal.users.userForToken, { token }) as Promise<Id<'users'>>;

// A library with a row in every table a user owns: `count` image items, all in
// one collection and every other one in a second, each with variants and an
// embedding; plus an upload, view preferences, a library map, an extension
// session and a lockout count
async function seedLibrary(t: Test, userId: Id<'users'>, prefix: string, count: number) {
	await t.run(async (ctx) => {
		const user = (await ctx.db.get(userId))!;
		const collections = [];
		for (const name of ['all', 'half']) {
			collections.push(await ctx.db.insert('collections', { userId, name, shared: true }));
		}
		for (let i = 0; i < count; i++) {
			const inCollections = i % 2 ? collections : collections.slice(0, 1);
			const imageKey = `${prefix}/${i}.png`;
			const itemId = await ctx.db.insert('items', {
				userId,
				type: 'image',
				imageKey,
				imageVariants: [{ key: `${prefix}/${i}-512w.webp`, width: 512 }],
				collections: inCollections,
				dateAdded: i,
				dateModified: i
			});
			for (const collectionId of inCollections) {
				await ctx.db.insert('itemCollectionPositions', {
					itemId,
					collectionId,
					position: `a${String(i).padStart(4, '0')}`,
					dateAdded: i
				});
			}
			await ctx.db.insert('itemEmbeddings', {
				itemId,
				userId,
				model: EMBEDDING_MODEL,
				inputKey: `image:${imageKey}`,
				embedding: Array(EMBEDDING_DIMENSIONS).fill(0.1)
			});
		}
		for (const collectionId of collections) {
			const itemCount = (
				await ctx.db
					.query('itemCollectionPositions')
					.withIndex('by_collection', (q) => q.eq('collectionId', collectionId))
					.collect()
			).length;
			await ctx.db.patch(collectionId, { itemCount });
		}
		await ctx.db.insert('uploads', { userId, key: `${prefix}-upload` });
		await ctx.db.insert('viewPreferences', { userId, key: 'home', sortMode: 'titleAsc' });
		await ctx.db.insert('embeddingMapStates', {
			userId,
			model: EMBEDDING_MODEL,
			version: 1,
			layoutVersion: 1
		});
		await ctx.db.insert('embeddingMapLayouts', { userId, model: EMBEDDING_MODEL, points: [] });
		await ctx.db.insert('sessions', {
			userId,
			tokenHash: await hashToken(`${prefix}-extension`),
			extension: true
		});
		await ctx.db.insert('loginAttempts', {
			username: user.username,
			count: 3,
			lastAttempt: Date.now()
		});
	});
}

// How many rows of each table belong to the user
async function ownedRows(t: Test, userId: Id<'users'>, username: string) {
	return await t.run(async (ctx) => {
		const byUser = async (
			table:
				'sessions' | 'uploads' | 'itemEmbeddings' | 'embeddingMapStates' | 'embeddingMapLayouts'
		) =>
			(
				await ctx.db
					.query(table)
					.withIndex('by_user', (q) => q.eq('userId', userId))
					.collect()
			).length;
		const collections = await ctx.db
			.query('collections')
			.withIndex('by_user_position', (q) => q.eq('userId', userId))
			.collect();
		const items = await ctx.db
			.query('items')
			.withIndex('by_user_dateAdded', (q) => q.eq('userId', userId))
			.collect();
		// Membership rows of the user's items or collections, whichever side remains
		const positions = (await ctx.db.query('itemCollectionPositions').collect()).filter(
			(row) =>
				items.some((item) => item._id === row.itemId) ||
				collections.some((collection) => collection._id === row.collectionId)
		);
		return {
			users: (await ctx.db.get(userId)) ? 1 : 0,
			sessions: await byUser('sessions'),
			collections: collections.length,
			items: items.length,
			itemCollectionPositions: positions.length,
			itemEmbeddings: await byUser('itemEmbeddings'),
			uploads: await byUser('uploads'),
			viewPreferences: (
				await ctx.db
					.query('viewPreferences')
					.withIndex('by_user_key', (q) => q.eq('userId', userId))
					.collect()
			).length,
			embeddingMapStates: await byUser('embeddingMapStates'),
			embeddingMapLayouts: await byUser('embeddingMapLayouts'),
			loginAttempts: (
				await ctx.db
					.query('loginAttempts')
					.withIndex('by_username', (q) => q.eq('username', username))
					.collect()
			).length
		};
	});
}

const scheduledBatches = (t: Test) =>
	t.run(
		async (ctx) =>
			(await ctx.db.system.query('_scheduled_functions').collect()).filter(
				(fn) => fn.name === 'users:deleteUserData' && fn.state.kind === 'pending'
			).length
	);

// Runs the deletion batches one by one, as the scheduler would, checking each
// queues the next until the user is gone; returns how many ran
async function runBatches(t: Test, userId: Id<'users'>) {
	for (let runs = 1; runs <= 100; runs++) {
		const pending = await scheduledBatches(t);
		await t.mutation(internal.users.deleteUserData, { userId });
		const gone = (await t.run((ctx) => ctx.db.get(userId))) === null;
		// Each run queues exactly one more, until the last
		expect(await scheduledBatches(t)).toBe(gone ? pending : pending + 1);
		if (gone) return runs;
	}
	throw new Error('deletion never finished');
}

describe('deleting an account', () => {
	test('needs the password: a wrong one is refused and counted', async () => {
		const t = newTest();
		const token = await signup(t, 'sam', 'correct horse');
		const userId = await userIdFor(t, token);

		await expect(
			t.action(api.sessions.deleteAccount, { token, password: 'wrong guess' })
		).rejects.toThrow('current password is wrong');

		const rows = await ownedRows(t, userId, 'sam');
		expect(rows).toMatchObject({ users: 1, sessions: 1, loginAttempts: 1 });
		expect(await scheduledBatches(t)).toBe(0);
		expect(await t.query(api.users.me, { token })).toEqual({ username: 'sam' });
	});

	test('shares the lockout: a locked name is refused even with the right password', async () => {
		const t = newTest();
		const token = await signup(t, 'sam', 'correct horse');
		await t.run((ctx) =>
			ctx.db.insert('loginAttempts', { username: 'sam', count: 10, lastAttempt: Date.now() })
		);

		await expect(
			t.action(api.sessions.deleteAccount, { token, password: 'correct horse' })
		).rejects.toThrow('too many attempts, try again later');
		expect(await scheduledBatches(t)).toBe(0);
	});

	test('a session without its user is Unauthorized', async () => {
		const t = newTest();
		await expect(
			t.action(api.sessions.deleteAccount, { token: 'nope', password: 'x' })
		).rejects.toThrow('Unauthorized');
	});

	test('signs out every session at once and stops new logins', async () => {
		const t = newTest();
		const token = await signup(t, 'sam', 'correct horse');
		const extension = await t.action(api.sessions.createExtensionToken, { token });
		const userId = await userIdFor(t, token);

		await t.action(api.sessions.deleteAccount, { token, password: 'correct horse' });

		// Before any batch has run
		expect(await ownedRows(t, userId, 'sam')).toMatchObject({ users: 1, sessions: 0 });
		expect(await scheduledBatches(t)).toBe(1);
		for (const dead of [token, extension]) {
			await expect(t.query(api.users.me, { token: dead })).rejects.toThrow('Unauthorized');
		}
		await expect(
			t.action(api.sessions.login, { username: 'sam', password: 'correct horse' })
		).rejects.toThrow('wrong username or password');

		await runBatches(t, userId);
		// The name is free again
		await signup(t, 'sam', 'battery staple');
	});

	test("deletes everything the user owns, over several batches, and nobody else's", async () => {
		const t = newTest();
		const a = await makeUser(t, 'a');
		const b = await makeUser(t, 'b');
		await seedLibrary(t, a.userId, 'a', 120);
		await seedLibrary(t, b.userId, 'b', 3);
		const bBefore = await ownedRows(t, b.userId, 'b');
		const bItems = await t.query(api.items.list, { token: b.token });

		await t.mutation(internal.users.startDeletion, { tokenHash: await hashToken(a.token) });
		// 120 items in the first collection takes two runs, the second one, then
		// five of items and one for the rest
		expect(await runBatches(t, a.userId)).toBe(9);

		expect(await ownedRows(t, a.userId, 'a')).toEqual({
			users: 0,
			sessions: 0,
			collections: 0,
			items: 0,
			itemCollectionPositions: 0,
			itemEmbeddings: 0,
			uploads: 0,
			viewPreferences: 0,
			embeddingMapStates: 0,
			embeddingMapLayouts: 0,
			loginAttempts: 0
		});
		const keys = deletedKeys();
		for (let i = 0; i < 120; i++) {
			expect(keys).toContain(`a/${i}.png`);
			expect(keys).toContain(`a/${i}-512w.webp`);
		}
		expect(keys).toContain('a-upload');
		expect(keys).toHaveLength(241);

		expect(await ownedRows(t, b.userId, 'b')).toEqual(bBefore);
		expect(await t.query(api.items.list, { token: b.token })).toEqual(bItems);
		const bCollections = await t.query(api.collections.listWithCounts, { token: b.token });
		expect(bCollections.map((c) => c.itemCount)).toEqual([3, 1]);
	});

	test('a shared collection stops being viewable after the first batch', async () => {
		const t = newTest();
		const a = await makeUser(t, 'a');
		await seedLibrary(t, a.userId, 'a', 2);
		const [first] = await t.query(api.collections.listWithCounts, { token: a.token });
		expect(await t.query(api.collections.get, { id: first._id })).not.toBeNull();

		await t.mutation(internal.users.startDeletion, { tokenHash: await hashToken(a.token) });
		await t.mutation(internal.users.deleteUserData, { userId: a.userId });
		expect(await t.query(api.collections.get, { id: first._id })).toBeNull();
	});

	test('work still running for the deleted items lands nowhere', async () => {
		const t = newTest();
		const a = await makeUser(t, 'a');
		await seedLibrary(t, a.userId, 'a', 1);
		const [{ _id: itemId }] = await t.query(api.items.list, { token: a.token });
		await t.mutation(internal.users.startDeletion, { tokenHash: await hashToken(a.token) });
		await runBatches(t, a.userId);
		deleted.mockClear();

		await t.mutation(internal.screenshots.setCompleted, {
			itemId,
			imageKey: 'screenshots/late.webp',
			imageWidth: 1,
			imageHeight: 1
		});
		await t.mutation(internal.screenshots.setFailed, { itemId, error: 'late' });
		await t.mutation(internal.tagging.setCompleted, {
			itemId,
			styles: [],
			subject: 'late',
			aiTags: []
		});
		await t.mutation(internal.tagging.setPaletteHex, { itemId, paletteHex: ['#000000'] });
		await t.mutation(internal.tagging.setFailed, { itemId, error: 'late' });
		await t.mutation(internal.embeddings.saveEmbedding, {
			itemId,
			inputKey: 'image:a/0.png',
			embedding: Array(EMBEDDING_DIMENSIONS).fill(0.1)
		});
		await t.mutation(internal.imageVariants.saveVariants, {
			itemId,
			imageKey: 'a/0.png',
			variants: [{ key: 'variants/late-512w.webp', width: 512 }]
		});
		await t.mutation(internal.embeddingMap.save, {
			userId: a.userId,
			model: EMBEDDING_MODEL,
			points: [],
			layoutVersion: 1
		});
		// An upload whose row went with the account while its bytes were checked
		await t.mutation(internal.r2.markVerified, {
			key: 'a-late-upload',
			contentType: 'image/png',
			width: 1,
			height: 1
		});

		expect(Object.values(await ownedRows(t, a.userId, 'a')).every((n) => n === 0)).toBe(true);
		expect(await t.run((ctx) => ctx.db.get(itemId))).toBeNull();
		expect(deletedKeys().sort()).toEqual([
			'a-late-upload',
			'screenshots/late.webp',
			'variants/late-512w.webp'
		]);
	});
});
