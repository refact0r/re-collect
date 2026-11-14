// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import workpool from '@convex-dev/workpool/test';
import type { WorkId } from '@convex-dev/workpool';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { api, internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import schema from './schema';
import { hashToken } from './lib/auth';
import { r2 } from './r2';

const modules = import.meta.glob('./**/*.ts');

function setup() {
	vi.useFakeTimers(); // Scheduled work runs only when a test drains it
	const t = convexTest(schema, modules);
	workpool.register(t, 'taggingPool');
	workpool.register(t, 'screenshotPool');
	const deleted = vi.spyOn(r2, 'deleteObject').mockResolvedValue();
	return { t, deleted };
}

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});

type Test = ReturnType<typeof convexTest>;

async function makeItem(t: Test, fields: Partial<Doc<'items'>> = {}) {
	const token = 'a-token';
	const itemId = await t.run(async (ctx) => {
		const userId = await ctx.db.insert('users', { username: 'a', passwordHash: 'unused' });
		await ctx.db.insert('sessions', { userId, tokenHash: await hashToken(token) });
		return ctx.db.insert('items', {
			userId,
			type: 'url',
			url: 'https://example.com',
			collections: [],
			dateAdded: 0,
			dateModified: 0,
			...fields
		});
	});
	return { itemId, token };
}

const getItem = (t: Test, itemId: Doc<'items'>['_id']) => t.run((ctx) => ctx.db.get(itemId));

describe('tagging always settles', () => {
	test('a run that died marks its busy item failed, and the item can be retagged', async () => {
		const { t } = setup();
		const { itemId, token } = await makeItem(t, { imageKey: 'a.png', taggingStatus: 'pending' });

		const complete = (result: { kind: 'failed'; error: string } | { kind: 'canceled' }) =>
			t.mutation(internal.tagging.onTaggingComplete, {
				workId: 'work' as WorkId,
				context: { itemId },
				result
			});
		await complete({ kind: 'failed', error: 'Your function ran out of memory' });
		expect(await getItem(t, itemId)).toMatchObject({
			taggingStatus: 'failed',
			taggingError: 'Your function ran out of memory'
		});

		await t.mutation(api.tagging.retagItem, { itemId, token });
		expect((await getItem(t, itemId))?.taggingStatus).toBe('pending');
		// A second retag can't start a run that overlaps the queued one
		await expect(t.mutation(api.tagging.retagItem, { itemId, token })).rejects.toThrow(
			'Tagging already in progress'
		);
	});

	test('a late failure never overwrites a run that already finished', async () => {
		const { t } = setup();
		const { itemId } = await makeItem(t, { taggingStatus: 'completed' });

		await t.mutation(internal.tagging.onTaggingComplete, {
			workId: 'work' as WorkId,
			context: { itemId },
			result: { kind: 'failed', error: 'late' }
		});
		expect(await getItem(t, itemId)).toMatchObject({ taggingStatus: 'completed' });
	});

	test('a queued text run whose URL was cleared settles as failed', async () => {
		const { t } = setup();
		const { itemId, token } = await makeItem(t);

		await t.mutation(api.tagging.retagItem, { itemId, mode: 'text', token });
		await t.run((ctx) => ctx.db.patch(itemId, { url: undefined }));
		await t.finishAllScheduledFunctions(vi.runAllTimers);

		expect(await getItem(t, itemId)).toMatchObject({
			taggingStatus: 'failed',
			taggingError: 'Item has no URL to tag'
		});
	});

	test('a queued image run whose image was removed settles as failed', async () => {
		const { t } = setup();
		const { itemId, token } = await makeItem(t, { imageKey: 'a.png' });

		await t.mutation(api.tagging.retagItem, { itemId, token });
		await t.run((ctx) => ctx.db.patch(itemId, { imageKey: undefined }));
		await t.finishAllScheduledFunctions(vi.runAllTimers);

		expect(await getItem(t, itemId)).toMatchObject({
			taggingStatus: 'failed',
			taggingError: 'Item has no image to tag'
		});
	});
});

describe('screenshots', () => {
	test('a capture that lands after its item was deleted deletes the new object', async () => {
		const { t, deleted } = setup();
		const { itemId } = await makeItem(t);
		await t.run((ctx) => ctx.db.delete(itemId));

		await t.mutation(internal.screenshots.setCompleted, {
			itemId,
			imageKey: 'screenshots/orphan.webp',
			imageWidth: 1440,
			imageHeight: 900
		});
		expect(deleted).toHaveBeenCalledExactlyOnceWith(expect.anything(), 'screenshots/orphan.webp');
	});

	test('a queued capture for a deleted item never calls the worker', async () => {
		const { t } = setup();
		vi.stubEnv('CLOUDFLARE_SCREENSHOT_URL', 'https://worker.invalid');
		vi.stubEnv('CLOUDFLARE_SCREENSHOT_KEY', 'key');
		const fetchSpy = vi.spyOn(globalThis, 'fetch');
		const { itemId } = await makeItem(t);
		await t.run((ctx) => ctx.db.delete(itemId));

		await t.action(internal.screenshots.generateScreenshotInternal, {
			itemId,
			url: 'https://example.com'
		});
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	test('a job that fails before claiming its item still settles it', async () => {
		const { t } = setup();
		const { itemId } = await makeItem(t, { screenshotStatus: 'pending' });

		await t.mutation(internal.screenshots.onScreenshotComplete, {
			workId: 'work' as WorkId,
			context: { itemId },
			result: { kind: 'failed', error: 'boom' }
		});
		expect(await getItem(t, itemId)).toMatchObject({
			screenshotStatus: 'failed',
			screenshotError: 'boom'
		});
	});
});

describe('uploads sweep', () => {
	test('deletes only day-old unconsumed uploads, with their objects', async () => {
		const { t, deleted } = setup();
		// Before any insert: convex-test keeps _creationTime monotonic
		vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
		const { token } = await makeItem(t);
		const userId = await t.run(async (ctx) => (await ctx.db.query('users').first())!._id);

		await t.run(async (ctx) => {
			await ctx.db.insert('uploads', { userId, key: 'abandoned' });
			await ctx.db.insert('uploads', { userId, key: 'consumed' });
		});
		await t.mutation(api.items.add, {
			type: 'image',
			imageKey: 'consumed',
			taggingMode: 'none',
			token
		});

		vi.setSystemTime(new Date('2026-01-02T12:00:00Z'));
		await t.run((ctx) => ctx.db.insert('uploads', { userId, key: 'fresh' }));
		await t.mutation(internal.r2.sweepUploads, {});

		const keys = await t.run(async (ctx) =>
			(await ctx.db.query('uploads').collect()).map((u) => u.key)
		);
		expect(keys).toEqual(['fresh']);
		expect(deleted).toHaveBeenCalledExactlyOnceWith(expect.anything(), 'abandoned');
	});
});
