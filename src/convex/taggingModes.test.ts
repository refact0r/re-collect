// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import workpool from '@convex-dev/workpool/test';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { api, internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import schema from './schema';
import { hashToken } from './lib/auth';
import { buildSearchText } from './lib/searchText';
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, embeddingInput, inputKey } from './lib/embedder';
import { r2 } from './r2';

// How an item is understood (taggingMode: look / content / off) across every
// item type, starting state and switch

const modules = import.meta.glob('./**/*.ts');
type Mode = 'visual' | 'text' | 'none';
type Test = Awaited<ReturnType<typeof setup>>['t'];

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

async function setup() {
	vi.useFakeTimers(); // Scheduled tagging, capture and embedding runs never start
	const t = convexTest(schema, modules);
	workpool.register(t, 'taggingPool');
	workpool.register(t, 'screenshotPool');
	vi.spyOn(r2, 'deleteObject').mockResolvedValue();
	const token = 'a-token';
	const userId = await t.run(async (ctx) => {
		const userId = await ctx.db.insert('users', { username: 'a', passwordHash: 'unused' });
		await ctx.db.insert('sessions', { userId, tokenHash: await hashToken(token) });
		return userId;
	});
	return { t, token, userId };
}

const getItem = (t: Test, id: Id<'items'>) => t.run((ctx) => ctx.db.get(id));
// Names of the functions scheduled so far (they never run under fake timers)
const scheduled = (t: Test) =>
	t.run(async (ctx) =>
		(await ctx.db.system.query('_scheduled_functions').collect()).map((fn) => fn.name)
	);
const embeddingRows = (t: Test, itemId: Id<'items'>) =>
	t.run((ctx) =>
		ctx.db
			.query('itemEmbeddings')
			.withIndex('by_item', (q) => q.eq('itemId', itemId))
			.collect()
	);

describe('adding an item snapshots the mode its type allows', () => {
	// [type, with its own image, collection default] → stored mode, tagging queued
	const cases: [Doc<'items'>['type'], boolean, Mode | undefined, Mode | undefined, boolean][] = [
		// Links waiting on the worker: visual tagging waits for the image to land
		['url', false, undefined, undefined, false],
		['url', false, 'visual', 'visual', false],
		['url', false, 'text', 'text', true],
		['url', false, 'none', 'none', false],
		// Links with the extension's image: visual tagging starts right away
		['url', true, undefined, undefined, true],
		['url', true, 'visual', 'visual', true],
		['url', true, 'text', 'text', true],
		['url', true, 'none', 'none', false],
		// Images can't be read as content, so a content default looks at them
		['image', true, undefined, undefined, true],
		['image', true, 'visual', 'visual', true],
		['image', true, 'text', 'visual', true],
		['image', true, 'none', 'none', false],
		// Notes are only ever read; they record just AI being off
		['text', false, undefined, undefined, false],
		['text', false, 'visual', undefined, false],
		['text', false, 'text', undefined, false],
		['text', false, 'none', 'none', false]
	];

	test.each(cases)(
		'%s (own image: %s) in a %s collection → %s, tagging queued: %s',
		async (type, ownImage, collectionMode, stored, queued) => {
			const { t, token, userId } = await setup();
			if (ownImage) await t.run((ctx) => ctx.db.insert('uploads', { userId, key: 'up-1' }));
			const collectionId = await t.mutation(api.collections.create, {
				name: 'c',
				...(collectionMode && { taggingMode: collectionMode }),
				token
			});
			const itemId = await t.mutation(api.items.add, {
				type,
				...(type === 'url' && { url: 'https://example.com' }),
				...(type === 'text' && { content: 'a note' }),
				...(ownImage && { imageKey: 'up-1', imageWidth: 10, imageHeight: 10 }),
				collections: [collectionId],
				token
			});
			const item = await getItem(t, itemId);
			expect(item?.taggingMode).toBe(stored);
			expect(item?.taggingStatus).toBe(queued ? 'pending' : undefined);
			if (type === 'url' && !ownImage) expect(item?.screenshotStatus).toBe('pending');
		}
	);

	test('a home default of off applies to collection-less adds of every type', async () => {
		const { t, token, userId } = await setup();
		await t.run((ctx) => ctx.db.insert('uploads', { userId, key: 'up-1' }));
		await t.mutation(api.viewPreferences.set, { key: 'home', taggingMode: 'none', token });
		const ids = await Promise.all([
			t.mutation(api.items.add, { type: 'url', url: 'https://example.com', token }),
			t.mutation(api.items.add, {
				type: 'image',
				imageKey: 'up-1',
				imageWidth: 1,
				imageHeight: 1,
				token
			}),
			t.mutation(api.items.add, { type: 'text', content: 'n', token })
		]);
		for (const id of ids) {
			expect(await getItem(t, id)).toMatchObject({ taggingMode: 'none' });
			expect((await getItem(t, id))?.taggingStatus).toBeUndefined();
		}
	});
});

describe('switching an item’s mode', () => {
	const TAGS = { subject: 'a red poster', styles: ['brutalist'], aiTags: ['zine'] };

	// A tagged, embedded item of the given shape
	async function taggedItem(t: Test, userId: Id<'users'>, fields: Partial<Doc<'items'>>) {
		return t.run(async (ctx) => {
			const base = {
				userId,
				type: 'url' as const,
				url: 'https://example.com',
				...TAGS,
				taggingStatus: 'completed' as const,
				taggingModelVersion: 'some-model',
				paletteHex: ['#ff0000'],
				fonts: [{ family: 'Inter' }],
				collections: [],
				dateAdded: 0,
				dateModified: 0,
				...fields
			};
			const itemId = await ctx.db.insert('items', { ...base, searchText: buildSearchText(base) });
			await ctx.db.insert('itemEmbeddings', {
				itemId,
				userId,
				model: EMBEDDING_MODEL,
				inputKey: base.imageKey ? `image:${base.imageKey}` : 'text:x',
				embedding: Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.1)
			});
			return itemId;
		});
	}

	const link = {
		type: 'url' as const,
		imageKey: 'shot.webp',
		screenshotStatus: 'completed' as const
	};
	const failedLink = { type: 'url' as const, screenshotStatus: 'failed' as const };
	const capturingLink = { ...link, screenshotStatus: 'pending' as const };
	const image = { type: 'image' as const, url: undefined, imageKey: 'pic.jpg' };
	// Notes are never tagged, so they carry none of the tagging fields
	const note = {
		type: 'text' as const,
		url: undefined,
		content: 'a note',
		subject: undefined,
		styles: undefined,
		aiTags: undefined,
		taggingStatus: undefined,
		taggingModelVersion: undefined
	};

	type Outcome = 'tags' | 'off' | 'content' | string; // a string is the error
	const starts: [string, Partial<Doc<'items'>>][] = [
		['a link', link],
		['a link whose capture failed', failedLink],
		['a link mid-capture', capturingLink],
		['an image', image],
		['a note', note]
	];
	const outcomes: Record<string, Record<Mode, Outcome>> = {
		'a link': { visual: 'tags', text: 'tags', none: 'off' },
		'a link whose capture failed': {
			visual: 'item has no image to tag',
			text: 'tags',
			none: 'off'
		},
		'a link mid-capture': {
			visual: 'image fetch in progress; wait for it to finish',
			text: 'tags',
			none: 'off'
		},
		'an image': { visual: 'tags', text: 'only URL items can be text-tagged', none: 'off' },
		'a note': { visual: 'notes are read by their content', text: 'content', none: 'off' }
	};

	const fromModes: (Mode | undefined)[] = [undefined, 'visual', 'text', 'none'];
	const cases = starts.flatMap(([name, fields]) =>
		fromModes
			// Each type only ever holds the modes it allows
			.filter((from) =>
				fields.type === 'text'
					? from === undefined || from === 'none'
					: fields.type === 'image'
						? from !== 'text'
						: true
			)
			.flatMap((from) =>
				(['visual', 'text', 'none'] as const).map(
					(to) => [name, from, to, fields, outcomes[name][to]] as const
				)
			)
	);

	test.each(cases)('%s in mode %s → %s', async (_name, from, to, fields, outcome) => {
		const { t, token, userId } = await setup();
		// An off item has no tags or embedding to start with
		const itemId =
			from === 'none'
				? await t.run((ctx) =>
						ctx.db.insert('items', {
							userId,
							type: 'url',
							url: 'https://example.com',
							collections: [],
							dateAdded: 0,
							dateModified: 0,
							...fields,
							taggingMode: 'none'
						})
					)
				: await taggedItem(t, userId, { ...fields, taggingMode: from });
		const before = await getItem(t, itemId);
		const rowsBefore = (await embeddingRows(t, itemId)).length;

		const run = t.mutation(api.tagging.retagItem, { itemId, mode: to, token });
		if (!['tags', 'off', 'content'].includes(outcome)) {
			await expect(run).rejects.toThrow(outcome);
			expect(await getItem(t, itemId)).toEqual(before);
			return;
		}
		await run;
		const item = await getItem(t, itemId);

		if (outcome === 'off') {
			expect(item?.taggingMode).toBe('none');
			for (const field of [
				'subject',
				'styles',
				'aiTags',
				'taggingStatus',
				'taggingError',
				'taggingModelVersion'
			] as const) {
				expect(item?.[field]).toBeUndefined();
			}
			// What AI wrote leaves search too; what the pixels and page gave stays
			expect(item?.searchText).not.toMatch(/brutalist|zine|red poster/);
			expect(item?.paletteHex).toEqual(before?.paletteHex);
			expect(item?.fonts).toEqual(before?.fonts);
			expect(await embeddingRows(t, itemId)).toHaveLength(0);
		} else if (outcome === 'content') {
			// A note isn't tagged, only (re-)embedded as its words
			expect(item?.taggingMode).toBeUndefined();
			expect(item?.taggingStatus).toBeUndefined();
			expect(await scheduled(t)).toContain('taggingActions:embedItem');
		} else {
			// The run is queued; the old tags and embedding stay until it lands
			expect(item).toMatchObject({ taggingMode: to, taggingStatus: 'pending' });
			if (from !== 'none') expect(item).toMatchObject(TAGS);
			expect(await embeddingRows(t, itemId)).toHaveLength(rowsBefore);
		}
	});

	test('nothing switches while a tagging run is queued, so no results land on an off item', async () => {
		const { t, token, userId } = await setup();
		const itemId = await taggedItem(t, userId, { ...link, taggingStatus: 'pending' });
		for (const mode of ['visual', 'text', 'none'] as const) {
			await expect(t.mutation(api.tagging.retagItem, { itemId, mode, token })).rejects.toThrow(
				'tagging already in progress'
			);
		}
		expect(await getItem(t, itemId)).toMatchObject({ taggingStatus: 'pending', ...TAGS });
	});

	test('turning an item off marks the library map stale', async () => {
		const { t, token, userId } = await setup();
		const itemId = await taggedItem(t, userId, link);
		await t.mutation(internal.embeddingMap.save, {
			userId,
			model: EMBEDDING_MODEL,
			points: [{ itemId, x: 0, y: 0 }],
			layoutVersion: 0
		});
		await t.mutation(api.tagging.retagItem, { itemId, mode: 'none', token });
		const map = await t.query(internal.embeddingMap.getForLayout, { userId });
		expect(map?.version).not.toBe(map?.layoutVersion);
	});
});

describe('an off item stays away from AI', () => {
	async function offLink(t: Test, userId: Id<'users'>, fields: Partial<Doc<'items'>> = {}) {
		return t.run((ctx) =>
			ctx.db.insert('items', {
				userId,
				type: 'url',
				url: 'https://example.com',
				taggingMode: 'none',
				collections: [],
				dateAdded: 0,
				dateModified: 0,
				...fields
			})
		);
	}

	// Only a look link tags its new image; the others just read its palette (local)
	test.each([
		['off', 'none', undefined],
		['look', 'visual', 'pending'],
		['content', 'text', undefined],
		['the default (look)', undefined, 'pending']
	] as const)('a new image landing on a %s link queues tagging: %s', async (_, mode, status) => {
		const { t, userId } = await setup();
		const itemId = await offLink(t, userId, { taggingMode: mode, screenshotStatus: 'pending' });
		await t.mutation(internal.screenshots.setCompleted, {
			itemId,
			imageKey: 'screenshots/new.webp',
			imageWidth: 10,
			imageHeight: 10
		});
		expect(await getItem(t, itemId)).toMatchObject({
			screenshotStatus: 'completed',
			imageKey: 'screenshots/new.webp'
		});
		expect((await getItem(t, itemId))?.taggingStatus).toBe(status);
		const fns = await scheduled(t);
		expect(fns.includes('taggingActions:repaletteItem')).toBe(status === undefined);
		expect(fns).toContain('taggingActions:embedItem');
	});

	test('its image can still be re-fetched, as a screenshot or og image', async () => {
		const { t, token, userId } = await setup();
		const itemId = await offLink(t, userId, {
			imageKey: 'old.webp',
			screenshotStatus: 'completed'
		});
		await t.mutation(api.screenshots.reimageItem, { itemId, mode: 'og', token });
		expect(await getItem(t, itemId)).toMatchObject({
			taggingMode: 'none',
			linkImageMode: 'og',
			screenshotStatus: 'pending'
		});
	});

	test('it has nothing to embed, and a run that started before it went off saves nothing', async () => {
		const { t, token, userId } = await setup();
		const itemId = await offLink(t, userId, {
			taggingMode: 'visual',
			imageKey: 'a.webp',
			screenshotStatus: 'completed'
		});
		const before = await t.query(internal.embeddings.getItemForEmbedding, { itemId });
		expect(before && embeddingInput(before.item)).toEqual({ kind: 'image', imageKey: 'a.webp' });

		// A run reads the item, then it's turned off before the run saves
		await t.mutation(api.tagging.retagItem, { itemId, mode: 'none', token });
		const after = await t.query(internal.embeddings.getItemForEmbedding, { itemId });
		expect(after && embeddingInput(after.item)).toBeNull();

		await t.mutation(internal.embeddings.saveEmbedding, {
			itemId,
			inputKey: await inputKey({ kind: 'image', imageKey: 'a.webp' }),
			embedding: Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.1)
		});
		expect(await embeddingRows(t, itemId)).toHaveLength(0);
	});

	test('the backfill deletes embeddings left on off items', async () => {
		const { t, userId } = await setup();
		const itemId = await offLink(t, userId);
		await t.run((ctx) =>
			ctx.db.insert('itemEmbeddings', {
				itemId,
				userId,
				model: EMBEDDING_MODEL,
				inputKey: 'image:a.webp',
				embedding: Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.1)
			})
		);
		await t.mutation(internal.embeddings.backfill, {});
		expect(await embeddingRows(t, itemId)).toHaveLength(0);
	});
});

test('the library map lays out only items embedded as images', async () => {
	const { t, userId } = await setup();
	const rows = await t.run(async (ctx) => {
		const ids: Id<'items'>[] = [];
		for (const key of ['image:a.webp', 'text:abc', 'image:b.jpg']) {
			const itemId = await ctx.db.insert('items', {
				userId,
				type: 'url',
				collections: [],
				dateAdded: 0,
				dateModified: 0
			});
			await ctx.db.insert('itemEmbeddings', {
				itemId,
				userId,
				model: EMBEDDING_MODEL,
				inputKey: key,
				embedding: Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.1)
			});
			ids.push(itemId);
		}
		return ids;
	});
	const page = await t.query(internal.embeddingMap.vectorPage, { userId, cursor: null });
	expect(page.rows.map((row) => row.itemId)).toEqual([rows[0], rows[2]]);
});
