// @vitest-environment node
import sharp from 'sharp';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { internal } from './_generated/api';
import { newTest, stubR2, type Test } from './testing.helpers';

// Runs in node, not edge-runtime: makeVariants decodes with sharp

const png = await sharp({
	create: { width: 3000, height: 900, channels: 3, background: '#c00' }
})
	.png()
	.toBuffer();

let deleted: ReturnType<typeof stubR2>;

beforeEach(() => {
	vi.useFakeTimers(); // Scheduled work never starts
	deleted = stubR2();
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

// Serves the original and answers each upload, failing those whose key matches
const stubBucket = (failing?: RegExp) => {
	const puts: string[] = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, init?: RequestInit) => {
			if (init?.method !== 'PUT') return new Response(new Uint8Array(png));
			const key = new URL(url).pathname.replace('/images/', '');
			puts.push(key);
			return new Response(null, { status: failing?.test(key) ? 500 : 200 });
		})
	);
	return puts;
};

const makeItem = (t: Test) =>
	t.run(async (ctx) => {
		const userId = await ctx.db.insert('users', { username: 'a', passwordHash: 'unused' });
		return ctx.db.insert('items', {
			userId,
			type: 'image',
			imageKey: 'a.png',
			collections: [],
			dateAdded: 0,
			dateModified: 0
		});
	});

test('uploads every copy and records them', async () => {
	const t = newTest();
	const itemId = await makeItem(t);
	const puts = stubBucket();
	await t.action(internal.imageVariantActions.makeVariants, { itemId });

	const item = await t.run((ctx) => ctx.db.get(itemId));
	expect(item?.imageVariants?.map(({ width }) => width)).toEqual([512, 2048]);
	expect(puts.sort()).toEqual(item?.imageVariants?.map(({ key }) => key).sort());
	expect(item).toMatchObject({ imageWidth: 3000, imageHeight: 900 });
});

test('a failed upload drops what the others stored, for the retry', async () => {
	const t = newTest();
	const itemId = await makeItem(t);
	const puts = stubBucket(/2048w/);
	await expect(t.action(internal.imageVariantActions.makeVariants, { itemId })).rejects.toThrow(
		'variant upload failed: 500'
	);

	expect(puts).toHaveLength(2);
	const stored = puts.filter((key) => key.endsWith('-512w.webp'));
	expect(deleted.mock.calls.map(([, key]) => key)).toEqual(stored);
	expect((await t.run((ctx) => ctx.db.get(itemId)))?.imageVariants).toBeUndefined();
});
