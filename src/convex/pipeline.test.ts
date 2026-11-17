// @vitest-environment edge-runtime
import type { WorkId } from '@convex-dev/workpool';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { api, internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import { MAX_ERROR_CHARS } from './lib/tagger';
import { r2 } from './r2';
import { makeUser, newTest, type Test } from './testing.helpers';

function setup() {
	vi.useFakeTimers(); // Scheduled work runs only when a test drains it
	const t = newTest();
	const deleted = vi.spyOn(r2, 'deleteObject').mockResolvedValue();
	return { t, deleted };
}

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});

async function makeItem(t: Test, fields: Partial<Doc<'items'>> = {}) {
	const { userId, token } = await makeUser(t);
	const itemId = await t.run((ctx) =>
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
			'tagging already in progress'
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

	test('a failed capture keeps the worker’s message, or its status without one', async () => {
		const { t } = setup();
		vi.stubEnv('CLOUDFLARE_SCREENSHOT_URL', 'https://worker.invalid');
		vi.stubEnv('CLOUDFLARE_SCREENSHOT_KEY', 'key');
		const { itemId } = await makeItem(t, { screenshotStatus: 'pending' });
		const capture = async (response: Response) => {
			vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response);
			await t.action(internal.screenshots.generateScreenshotInternal, {
				itemId,
				url: 'https://example.com'
			});
			return (await getItem(t, itemId))?.screenshotError;
		};

		expect(await capture(Response.json({ error: 'Page load timeout' }, { status: 504 }))).toBe(
			'Page load timeout'
		);
		expect(await capture(new Response('<html>Bad gateway</html>', { status: 502 }))).toBe(
			'Screenshot service returned 502'
		);
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

	test('a failed re-fetch keeps showing the old image, until a capture succeeds', async () => {
		const { t } = setup();
		const { itemId, token } = await makeItem(t, {
			imageKey: 'old.webp',
			screenshotStatus: 'completed'
		});
		const shown = async () => {
			const [item] = await t.query(api.items.list, { token });
			return {
				status: item.screenshotStatus,
				imageUrl: item.imageUrl,
				error: item.screenshotError
			};
		};

		await t.mutation(api.screenshots.reimageItem, { itemId, token });
		await t.mutation(internal.screenshots.setFailed, { itemId, error: 'x'.repeat(10_000) });
		const afterError = await shown();
		expect(afterError).toMatchObject({
			status: 'completed',
			imageUrl: expect.stringMatching(/old\.webp$/)
		});
		expect(afterError.error).toHaveLength(MAX_ERROR_CHARS);

		await t.mutation(api.screenshots.reimageItem, { itemId, token });
		await t.mutation(internal.screenshots.onScreenshotComplete, {
			workId: 'work' as WorkId,
			context: { itemId },
			result: { kind: 'failed', error: 'rate limited' }
		});
		expect(await shown()).toMatchObject({ status: 'completed', error: 'rate limited' });

		await t.mutation(internal.screenshots.setCompleted, {
			itemId,
			imageKey: 'new.webp',
			imageWidth: 10,
			imageHeight: 10
		});
		expect(await shown()).toMatchObject({
			status: 'completed',
			imageUrl: expect.stringMatching(/new\.webp$/),
			error: undefined
		});
	});

	// Only a look link tags its new image; content and off links just read its palette
	test.each([
		['visual', true],
		['text', false],
		['none', false]
	] as const)(
		'a new image replacing the old in %s mode deletes it; queues tagging: %s',
		async (taggingMode, tags) => {
			const { t, deleted } = setup();
			const { itemId } = await makeItem(t, {
				taggingMode,
				imageKey: 'old.webp',
				screenshotStatus: 'pending'
			});

			await t.mutation(internal.screenshots.setCompleted, {
				itemId,
				imageKey: 'new.webp',
				imageWidth: 10,
				imageHeight: 10
			});
			expect(deleted).toHaveBeenCalledExactlyOnceWith(expect.anything(), 'old.webp');
			expect((await getItem(t, itemId))?.taggingStatus).toBe(tags ? 'pending' : undefined);
			const scheduled = await t.run(async (ctx) =>
				(await ctx.db.system.query('_scheduled_functions').collect()).map((fn) => fn.name)
			);
			// The look run is queued on the tagging pool, marked by its pending status
			expect(scheduled.includes('taggingActions:repaletteItem')).toBe(!tags);
		}
	);
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
			await ctx.db.insert('uploads', { userId, key: 'consumed', verifiedType: 'image/png' });
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
