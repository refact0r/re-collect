// @vitest-environment node
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { USER_LIMITS } from './lib/rateLimits';
import { makeUser, newTest, stubR2, type Test } from './testing.helpers';

// Runs in node, not edge-runtime: imageImport's actions decode images with sharp

const png = await sharp({ create: { width: 3, height: 2, channels: 3, background: '#c00' } })
	.png()
	.toBuffer();
const dataUrl = `data:image/png;base64,${png.toString('base64')}`;

let fetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
	// Scheduled work never starts, and the buckets don't refill unless a test moves the clock
	vi.useFakeTimers();
	stubR2();
	vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'account');
	vi.stubEnv('CLOUDFLARE_API_TOKEN', 'token');
	// Workers AI for searches, the bucket for server-side PUTs
	fetch = vi.fn(async (_url: string, init?: RequestInit) =>
		init?.method === 'PUT'
			? new Response(null, { status: 200 })
			: Response.json({ result: { data: [{ embedding: Array(768).fill(0.1) }] } })
	);
	vi.stubGlobal('fetch', fetch);
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});

const { save, retag, upload, search } = USER_LIMITS;

async function times(n: number, call: () => Promise<unknown>) {
	for (let i = 0; i < n; i++) await call();
}

const addNote = (t: Test, token: string) =>
	t.mutation(api.items.add, { type: 'text', content: 'a note', token });

// Everything a refused call could have left behind
const footprint = (t: Test) =>
	t.run(async (ctx) => ({
		items: (await ctx.db.query('items').collect()).length,
		uploads: (await ctx.db.query('uploads').collect()).length,
		scheduled: (await ctx.db.system.query('_scheduled_functions').collect()).length
	}));

const insertItem = (t: Test, userId: Id<'users'>, fields: Partial<Doc<'items'>>) =>
	t.run((ctx) =>
		ctx.db.insert('items', {
			userId,
			type: 'url',
			url: 'https://example.com',
			collections: [],
			dateAdded: 0,
			dateModified: 0,
			...fields
		})
	);

describe('save', () => {
	test('refuses past its capacity, saying when to try again, and does nothing', async () => {
		const t = newTest();
		const { token } = await makeUser(t);
		await times(save.capacity, () => addNote(t, token));

		const before = await footprint(t);
		await expect(addNote(t, token)).rejects.toThrow(
			'you’ve saved a lot today, try again in about 7 minutes'
		);
		expect(await footprint(t)).toEqual(before);
		expect(before.items).toBe(save.capacity);

		// Nothing was queued for it: only the saved notes get embedded
		await t.finishAllScheduledFunctions(vi.runAllTimers);
		expect(fetch).toHaveBeenCalledTimes(save.capacity);
	});

	test('refills over the day', async () => {
		const t = newTest();
		const { token } = await makeUser(t);
		await times(save.capacity, () => addNote(t, token));
		vi.setSystemTime(Date.now() + 8 * 60 * 1000);
		await addNote(t, token);
		await expect(addNote(t, token)).rejects.toThrow('try again');
	});

	test('is each user’s own', async () => {
		const t = newTest();
		const a = await makeUser(t, 'a');
		const b = await makeUser(t, 'b');
		await times(save.capacity, () => addNote(t, a.token));
		await expect(addNote(t, a.token)).rejects.toThrow('you’ve saved a lot today');
		await addNote(t, b.token);
	});

	test('counts a new capture, and refuses one without touching the item', async () => {
		const t = newTest();
		const { userId, token } = await makeUser(t);
		const itemId = await insertItem(t, userId, { screenshotStatus: 'completed' });
		await t.mutation(api.screenshots.reimageItem, { itemId, token });
		await times(save.capacity - 1, () => addNote(t, token));

		await t.run((ctx) => ctx.db.patch(itemId, { screenshotStatus: 'completed' }));
		const before = await footprint(t);
		await expect(t.mutation(api.screenshots.reimageItem, { itemId, token })).rejects.toThrow(
			'you’ve saved a lot today'
		);
		expect(await footprint(t)).toEqual(before);
		expect((await t.run((ctx) => ctx.db.get(itemId)))?.screenshotStatus).toBe('completed');
	});
});

describe('retag', () => {
	test('refuses past its capacity without touching the item, but AI off still works', async () => {
		const t = newTest();
		const { userId, token } = await makeUser(t);
		const note = await insertItem(t, userId, { type: 'text', url: undefined, content: 'x' });
		await times(retag.capacity, () =>
			t.mutation(api.tagging.retagItem, { itemId: note, mode: 'text', token })
		);

		const image = await insertItem(t, userId, { imageKey: 'a.png', taggingMode: 'visual' });
		const before = await footprint(t);
		await expect(t.mutation(api.tagging.retagItem, { itemId: image, token })).rejects.toThrow(
			'you’ve re-tagged a lot today, try again in about 5 minutes'
		);
		expect(await footprint(t)).toEqual(before);
		expect((await t.run((ctx) => ctx.db.get(image)))?.taggingStatus).toBeUndefined();

		await t.mutation(api.tagging.retagItem, { itemId: image, mode: 'none', token });
		expect((await t.run((ctx) => ctx.db.get(image)))?.taggingMode).toBe('none');
	});
});

describe('upload', () => {
	const uploadUrl = (t: Test, token: string) =>
		t.mutation(api.r2.generateUploadUrl, { contentType: 'image/png', token });

	test('refuses an upload URL past its capacity', async () => {
		const t = newTest();
		const { token } = await makeUser(t);
		await times(upload.capacity, () => uploadUrl(t, token));

		const before = await footprint(t);
		await expect(uploadUrl(t, token)).rejects.toThrow(
			'you’ve uploaded a lot of images today, try again in about 7 minutes'
		);
		expect(await footprint(t)).toEqual(before);
	});

	test('counts a server-side import once, and refuses imports before fetching', async () => {
		const t = newTest();
		const a = await makeUser(t, 'a');
		await t.action(api.imageImport.addFromUrl, { imageUrl: dataUrl, token: a.token });
		await times(upload.capacity - 1, () => uploadUrl(t, a.token));
		fetch.mockClear();

		const candidateId = await t.run((ctx) =>
			ctx.db.insert('discoveryCandidates', {
				sourceKey: 'awwwards',
				externalId: '1',
				normUrl: 'example.com/post',
				kind: 'image',
				url: 'https://example.com/post',
				imageUrl: 'https://example.com/image.png',
				publishedAt: 0
			})
		);
		const before = await footprint(t);
		for (const call of [
			t.action(api.imageImport.addFromUrl, {
				imageUrl: 'https://example.com/image.png',
				pageUrl: 'https://example.com',
				token: a.token
			}),
			t.action(api.imageImport.addPageWithImage, {
				url: 'https://example.com',
				imageUrl: dataUrl,
				token: a.token
			}),
			t.action(api.discoveryKeep.keep, { candidateId, token: a.token })
		]) {
			await expect(call).rejects.toThrow('you’ve uploaded a lot of images today');
		}
		expect(fetch).not.toHaveBeenCalled();
		expect(await footprint(t)).toEqual(before);
	});

	test('refuses an image whose item couldn’t be saved, without spending an upload', async () => {
		const t = newTest();
		const { token } = await makeUser(t);
		await times(save.capacity, () => addNote(t, token));
		const before = await footprint(t);

		await expect(uploadUrl(t, token)).rejects.toThrow('you’ve saved a lot today');
		await expect(
			t.action(api.imageImport.addFromUrl, {
				imageUrl: 'https://example.com/image.png',
				token
			})
		).rejects.toThrow('you’ve saved a lot today');
		expect(fetch).not.toHaveBeenCalled();
		expect(await footprint(t)).toEqual(before);

		// Once a save is back, every upload is still there: an upload URL only
		// checks for a save, which the item's items.add spends
		vi.setSystemTime(Date.now() + 8 * 60 * 1000);
		await times(upload.capacity, () => uploadUrl(t, token));
		await expect(uploadUrl(t, token)).rejects.toThrow('you’ve uploaded a lot of images today');
	});
});

describe('search', () => {
	test('refuses past its capacity without calling Workers AI', async () => {
		const t = newTest();
		const a = await makeUser(t, 'a');
		const b = await makeUser(t, 'b');
		const find = (token: string) => t.action(api.embeddings.search, { query: 'risograph', token });
		await times(search.capacity, () => find(a.token));
		expect(fetch).toHaveBeenCalledTimes(search.capacity);

		await expect(find(a.token)).rejects.toThrow(
			'lots of searches at once, try again in a few seconds'
		);
		expect(fetch).toHaveBeenCalledTimes(search.capacity);
		await find(b.token);
	});
});
