// @vitest-environment edge-runtime
import { Workpool } from '@convex-dev/workpool';
import { getFunctionName } from 'convex/server';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { api, internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { hashToken } from './lib/auth';
import { r2 } from './r2';
import { newTest, type Test } from './testing.helpers';

const MAKE_VARIANTS = 'imageVariantActions:makeVariants';
const VARIANTS = [
	{ key: 'variants/v-256w.webp', width: 256 },
	{ key: 'variants/v-768w.webp', width: 768 }
];

function setup() {
	vi.useFakeTimers(); // Queued runs never start
	vi.stubEnv('R2_PUBLIC_URL', 'https://img.test');
	const t = newTest();
	const enqueued = vi.spyOn(Workpool.prototype, 'enqueueAction');
	const deleted = vi.spyOn(r2, 'deleteObject').mockResolvedValue();
	return { t, deleted, queued: () => enqueued.mock.calls.map(([, fn]) => getFunctionName(fn)) };
}

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});

async function makeItem(t: Test, fields: Partial<Doc<'items'>> = {}) {
	const token = 'a-token';
	const itemId = await t.run(async (ctx) => {
		const userId = await ctx.db.insert('users', { username: 'a', passwordHash: 'unused' });
		await ctx.db.insert('sessions', { userId, tokenHash: await hashToken(token) });
		return ctx.db.insert('items', {
			userId,
			type: 'image',
			imageKey: 'a.png',
			imageWidth: 1440,
			imageHeight: 900,
			collections: [],
			dateAdded: 0,
			dateModified: 0,
			...fields
		});
	});
	return { itemId, token };
}

const getItem = (t: Test, itemId: Id<'items'>) => t.run((ctx) => ctx.db.get(itemId));
const deletedKeys = (deleted: ReturnType<typeof setup>['deleted']) =>
	deleted.mock.calls.map(([, key]) => key);

describe('saving variants', () => {
	test('records them for the current image, and the srcset lists them', async () => {
		const { t } = setup();
		const { itemId, token } = await makeItem(t);
		await t.mutation(internal.imageVariants.saveVariants, {
			itemId,
			imageKey: 'a.png',
			variants: VARIANTS
		});
		expect((await getItem(t, itemId))?.imageVariants).toEqual(VARIANTS);

		const [shown] = await t.query(api.items.list, { token });
		expect(shown.imageUrl).toBe('https://img.test/a.png');
		expect(shown.imageSrcset).toBe(
			'https://img.test/variants/v-256w.webp 256w, https://img.test/variants/v-768w.webp 768w, https://img.test/a.png 1440w'
		);
	});

	test('drops them when the image was replaced or deleted meanwhile', async () => {
		const { t, deleted } = setup();
		const { itemId } = await makeItem(t, { imageKey: 'b.png' });
		await t.mutation(internal.imageVariants.saveVariants, {
			itemId,
			imageKey: 'a.png',
			variants: VARIANTS
		});
		expect((await getItem(t, itemId))?.imageVariants).toBeUndefined();
		expect(deletedKeys(deleted)).toEqual(VARIANTS.map((v) => v.key));

		await t.run((ctx) => ctx.db.delete(itemId));
		await t.mutation(internal.imageVariants.saveVariants, {
			itemId,
			imageKey: 'b.png',
			variants: VARIANTS.slice(0, 1)
		});
		expect(deletedKeys(deleted)).toHaveLength(3);
	});

	test('a second run for the same image keeps the first', async () => {
		const { t, deleted } = setup();
		const { itemId } = await makeItem(t, { imageVariants: VARIANTS });
		const late = [{ key: 'variants/late-256w.webp', width: 256 }];
		await t.mutation(internal.imageVariants.saveVariants, {
			itemId,
			imageKey: 'a.png',
			variants: late
		});
		expect((await getItem(t, itemId))?.imageVariants).toEqual(VARIANTS);
		expect(deletedKeys(deleted)).toEqual(['variants/late-256w.webp']);
	});

	test('fills in a size the item lacked', async () => {
		const { t } = setup();
		const { itemId } = await makeItem(t, { imageWidth: undefined, imageHeight: undefined });
		await t.mutation(internal.imageVariants.saveVariants, {
			itemId,
			imageKey: 'a.png',
			variants: [],
			width: 300,
			height: 200
		});
		expect(await getItem(t, itemId)).toMatchObject({
			imageVariants: [],
			imageWidth: 300,
			imageHeight: 200
		});
	});
});

describe('the image lifecycle', () => {
	test('adding an item with an image queues its variants', async () => {
		const { t, queued } = setup();
		const { itemId, token } = await makeItem(t);
		await t.run(async (ctx) => {
			const userId = (await ctx.db.get(itemId))!.userId;
			await ctx.db.insert('uploads', { userId, key: 'x', verifiedType: 'image/png' });
		});
		await t.mutation(api.items.add, { type: 'image', imageKey: 'x', token });
		expect(queued()).toContain(MAKE_VARIANTS);

		await t.mutation(api.items.add, { type: 'text', content: 'hi', token });
		expect(queued().filter((name) => name === MAKE_VARIANTS)).toHaveLength(1);
	});

	test('deleting an item deletes its image and variants', async () => {
		const { t, deleted } = setup();
		const { itemId, token } = await makeItem(t, { imageVariants: VARIANTS });
		await t.mutation(api.items.remove, { id: itemId, token });
		expect(deletedKeys(deleted).sort()).toEqual(['a.png', ...VARIANTS.map((v) => v.key)].sort());
	});

	test('a new capture replaces the old image and its variants, then queues new ones', async () => {
		const { t, deleted, queued } = setup();
		const { itemId } = await makeItem(t, {
			type: 'url',
			url: 'https://example.com',
			imageKey: 'screenshots/old.webp',
			imageVariants: VARIANTS,
			taggingMode: 'none'
		});
		await t.mutation(internal.screenshots.setCompleted, {
			itemId,
			imageKey: 'screenshots/new.webp',
			imageWidth: 1440,
			imageHeight: 900
		});
		const item = await getItem(t, itemId);
		expect(item?.imageKey).toBe('screenshots/new.webp');
		expect(item?.imageVariants).toBeUndefined();
		expect(deletedKeys(deleted).sort()).toEqual(
			['screenshots/old.webp', ...VARIANTS.map((v) => v.key)].sort()
		);
		expect(queued()).toContain(MAKE_VARIANTS);
	});

	test('the backfill queues only images without variants', async () => {
		const { t, queued } = setup();
		const { itemId } = await makeItem(t);
		await t.run(async (ctx) => {
			const userId = (await ctx.db.get(itemId))!.userId;
			const base = { userId, collections: [], dateAdded: 0, dateModified: 0 };
			await ctx.db.insert('items', {
				...base,
				type: 'image',
				imageKey: 'b.png',
				imageVariants: []
			});
			await ctx.db.insert('items', { ...base, type: 'text', content: 'hi' });
		});
		await t.mutation(internal.imageVariants.backfill, {});
		expect(queued()).toEqual([MAKE_VARIANTS]);
		expect(vi.mocked(Workpool.prototype.enqueueAction).mock.calls[0][2]).toEqual({ itemId });
	});
});
