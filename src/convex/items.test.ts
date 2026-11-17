// @vitest-environment edge-runtime
import { generateKeyBetween } from 'fractional-indexing';
import { expect, test, vi } from 'vitest';
import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { normalizeUrl } from './lib/urls';
import { makeUser, newTest, type Test } from './testing.helpers';

test('per-save overrides replace the collection’s ingestion defaults', async () => {
	vi.useFakeTimers(); // Keep the scheduled tagging actions from running
	const t = newTest();
	const { userId, token } = await makeUser(t);
	await t.run(async (ctx) => {
		await ctx.db.insert('uploads', { userId, key: 'key-1', verifiedType: 'image/png' });
		await ctx.db.insert('uploads', { userId, key: 'key-2', verifiedType: 'image/png' });
	});
	const collectionId = await t.mutation(api.collections.create, {
		name: 'untagged',
		taggingMode: 'none',
		token
	});

	// URL items with their own image skip the worker, so nothing gets enqueued
	const add = (imageKey: string, overrides = {}) =>
		t.mutation(api.items.add, {
			type: 'url',
			url: 'https://example.com',
			imageKey,
			collections: [collectionId],
			token,
			...overrides
		});
	const defaulted = await add('key-1');
	const overridden = await add('key-2', { taggingMode: 'visual', linkImageMode: 'og' });

	const [a, b] = await t.run((ctx) => Promise.all([ctx.db.get(defaulted), ctx.db.get(overridden)]));
	expect(a).toMatchObject({ userId, taggingMode: 'none' });
	expect(a?.taggingStatus).toBeUndefined();
	expect(b).toMatchObject({ taggingMode: 'visual', linkImageMode: 'og', taggingStatus: 'pending' });
	vi.useRealTimers();
});

test('captured fonts are stored, searchable, and kept when a capture brings none', async () => {
	vi.useFakeTimers(); // Keep the scheduled palette/tagging actions from running
	const t = newTest();
	const itemId = await t.run(async (ctx) => {
		const userId = await ctx.db.insert('users', { username: 'a', passwordHash: 'unused' });
		return ctx.db.insert('items', {
			userId,
			type: 'url',
			url: 'https://klim.co.nz',
			taggingMode: 'none',
			collections: [],
			dateAdded: 0,
			dateModified: 0
		});
	});
	const complete = (fonts?: { family: string; internalName?: string }[]) =>
		t.mutation(internal.screenshots.setCompleted, {
			itemId,
			imageKey: 'screenshots/klim.webp',
			imageWidth: 1440,
			imageHeight: 900,
			fonts
		});

	await complete([{ family: 'SOEHNE', internalName: 'Söhne' }]);
	await complete(); // og fast path: no browser, no fonts
	const item = await t.run((ctx) => ctx.db.get(itemId));
	expect(item?.fonts).toEqual([{ family: 'SOEHNE', internalName: 'Söhne' }]);
	expect(item?.searchText?.toLowerCase()).toContain('soehne');
	vi.useRealTimers();
});

// Inserted directly: items.add would enqueue a screenshot on the workpool component
function insertUrlItem(
	t: Test,
	userId: Id<'users'>,
	fields: { url: string; title?: string; description?: string }
) {
	return t.run((ctx) =>
		ctx.db.insert('items', {
			userId,
			type: 'url',
			...fields,
			collections: [],
			dateAdded: 0,
			dateModified: 0
		})
	);
}

test('only http(s) links become URL items', async () => {
	const t = newTest();
	const { userId, token } = await makeUser(t);

	for (const url of [
		'note: buy milk tomorrow',
		'mailto:a@b.co',
		'javascript:alert(1)',
		undefined
	]) {
		await expect(t.mutation(api.items.add, { type: 'url', url, token })).rejects.toThrow(
			'links must start with http:// or https://'
		);
	}
	const itemId = await insertUrlItem(t, userId, { url: 'https://a.co' });
	await expect(
		t.mutation(api.items.update, { id: itemId, url: 'file:///etc/hosts', token })
	).rejects.toThrow('links must start with http:// or https://');
	await t.mutation(api.items.update, { id: itemId, url: ' http://b.co ', token });
	expect((await t.run((ctx) => ctx.db.get(itemId)))?.url).toBe('http://b.co');
});

test('a URL item keeps its link; other items can drop theirs', async () => {
	const t = newTest();
	const { userId, token } = await makeUser(t);
	const link = await insertUrlItem(t, userId, { url: 'https://a.co' });
	await expect(t.mutation(api.items.update, { id: link, url: '  ', token })).rejects.toThrow(
		'links must start with http:// or https://'
	);
	expect((await t.run((ctx) => ctx.db.get(link)))?.url).toBe('https://a.co');

	const image = await t.run((ctx) =>
		ctx.db.insert('items', {
			userId,
			type: 'image',
			url: 'https://a.co',
			collections: [],
			dateAdded: 0,
			dateModified: 0
		})
	);
	await t.mutation(api.items.update, { id: image, url: '', token });
	const item = await t.run((ctx) => ctx.db.get(image));
	expect(item).not.toHaveProperty('url');
	expect(item).not.toHaveProperty('normUrl');
});

test('update leaves omitted fields alone and clears blank ones', async () => {
	const t = newTest();
	const { userId, token } = await makeUser(t);
	const itemId = await insertUrlItem(t, userId, {
		url: 'https://b.co',
		title: 'zebra',
		description: 'notes'
	});

	await t.mutation(api.items.update, { id: itemId, title: '  ', token });
	const item = await t.run((ctx) => ctx.db.get(itemId));
	expect(item).not.toHaveProperty('title');
	expect(item).toMatchObject({ url: 'https://b.co', description: 'notes' });
	expect(item?.searchText).toBe('notes https://b.co');
});

test('a stored empty title sorts by url, not first', async () => {
	const t = newTest();
	const { userId, token } = await makeUser(t);
	const legacy = await insertUrlItem(t, userId, { url: 'https://zine.co', title: '' });
	const titled = await insertUrlItem(t, userId, { url: 'https://b.co', title: 'apple' });

	const items = await t.query(api.items.list, { sortBy: 'titleAsc', token });
	expect(items.map((i) => i._id)).toEqual([titled, legacy]);
});

test('text items are searchable by their content', async () => {
	const t = newTest();
	const { token } = await makeUser(t);
	const search = async (query: string) =>
		(await t.query(api.items.search, { query, token })).map((i) => i._id);

	const itemId = await t.mutation(api.items.add, {
		type: 'text',
		content: 'risograph paper supplier',
		token
	});
	expect(await search('risograph')).toEqual([itemId]);

	await t.mutation(api.items.update, { id: itemId, content: 'letterpress studio', token });
	expect(await search('risograph')).toEqual([]);
	expect(await search('letterpress')).toEqual([itemId]);
});

test('an owner’s listings leave out the fields no page reads', async () => {
	vi.stubEnv('R2_PUBLIC_URL', 'https://img.test');
	const t = newTest();
	const { userId, token } = await makeUser(t);
	const collectionId = await t.mutation(api.collections.create, { name: 'c', token });
	const itemId = await t.run((ctx) =>
		ctx.db.insert('items', {
			userId,
			type: 'url',
			url: 'https://a.co',
			normUrl: normalizeUrl('https://a.co'),
			imageKey: 'a.png',
			imageWidth: 3000,
			imageVariants: [{ key: 'variants/a-512w.webp', width: 512 }],
			paletteNames: ['red'],
			searchText: 'poster https://a.co',
			collections: [],
			dateAdded: 0,
			dateModified: 0
		})
	);
	await t.mutation(api.items.addToCollection, { itemId, collectionId, token });

	const listings = [
		await t.query(api.items.list, { token }),
		await t.query(api.items.search, { query: 'poster', token }),
		await t.query(api.items.listByCollection, { collectionId, token }),
		await t.query(api.items.searchCollection, { collectionId, query: 'poster', token })
	];
	for (const [item] of listings) {
		expect(item).toMatchObject({
			searchText: 'poster https://a.co',
			collections: [collectionId],
			imageUrl: 'https://img.test/a.png',
			imageSrcset: expect.stringContaining('variants/a-512w.webp')
		});
		for (const field of ['userId', 'normUrl', 'imageVariants', 'paletteNames']) {
			expect(item).not.toHaveProperty(field);
		}
	}
	vi.unstubAllEnvs();
});

test('an image gets the size its verified upload decoded to', async () => {
	vi.useFakeTimers(); // Keep the scheduled palette/variant actions from running
	const t = newTest();
	const { userId, token } = await makeUser(t);
	await t.run((ctx) =>
		ctx.db.insert('uploads', {
			userId,
			key: 'sized',
			verifiedType: 'image/png',
			width: 30,
			height: 20
		})
	);
	const itemId = await t.mutation(api.items.add, { type: 'image', imageKey: 'sized', token });

	expect(await t.run((ctx) => ctx.db.get(itemId))).toMatchObject({
		imageWidth: 30,
		imageHeight: 20
	});
	vi.useRealTimers();
});

test('view preferences only keep the rows the pages use', async () => {
	const t = newTest();
	const { token } = await makeUser(t);
	for (const key of ['home', 'search', 'discover'] as const) {
		await t.mutation(api.viewPreferences.set, { key, viewMode: 'list', token });
		expect(await t.query(api.viewPreferences.get, { key, token })).toMatchObject({
			key,
			viewMode: 'list'
		});
	}
	for (const key of ['collection', 'home2', '']) {
		await expect(
			// @ts-expect-error: not a page's key
			t.mutation(api.viewPreferences.set, { key, viewMode: 'list', token })
		).rejects.toThrow();
	}
	expect(await t.run((ctx) => ctx.db.query('viewPreferences').collect())).toHaveLength(3);
});

test('rebuildSearchText recomputes searchText from current fields', async () => {
	const t = newTest();
	const itemId = await t.run(async (ctx) => {
		const userId = await ctx.db.insert('users', { username: 'a', passwordHash: 'unused' });
		return ctx.db.insert('items', {
			userId,
			type: 'text',
			content: 'risograph paper supplier',
			searchText: '',
			collections: [],
			dateAdded: 0,
			dateModified: 0
		});
	});
	await t.mutation(internal.items.rebuildSearchText, {});
	const item = await t.run((ctx) => ctx.db.get(itemId));
	expect(item).toMatchObject({ searchText: 'risograph paper supplier', dateModified: 0 });
});

test('dropTaggingModelVersion clears the field on every page and leaves the rest', async () => {
	vi.useFakeTimers();
	const t = newTest();
	// More than one page, every other item tagged by a recorded model
	await t.run(async (ctx) => {
		const userId = await ctx.db.insert('users', { username: 'a', passwordHash: 'unused' });
		for (let i = 0; i < 150; i++) {
			await ctx.db.insert('items', {
				userId,
				type: 'text',
				content: `note ${i}`,
				searchText: `note ${i}`,
				...(i % 2 ? { taggingModelVersion: 'openai/gpt-6-luna:v5' } : {}),
				collections: [],
				dateAdded: i,
				dateModified: i
			});
		}
	});
	const items = () => t.run((ctx) => ctx.db.query('items').collect());
	const drop = async () => {
		await t.mutation(internal.items.dropTaggingModelVersion, {});
		await t.finishAllScheduledFunctions(vi.runAllTimers);
	};

	const before = await items();
	await drop();
	const after = await items();
	expect(after).toEqual(before.map(({ taggingModelVersion: _, ...item }) => item));

	await drop();
	expect(await items()).toEqual(after);
	vi.useRealTimers();
});

test('dropDateCreated clears the field and leaves the rest', async () => {
	const t = newTest();
	const { token } = await makeUser(t);
	await t.mutation(api.collections.create, { name: 'new', token });
	await t.run(async (ctx) => {
		const collection = await ctx.db.query('collections').first();
		for (const name of ['old', 'older']) {
			await ctx.db.insert('collections', {
				userId: collection!.userId,
				name,
				dateCreated: 1,
				position: collection!.position
			});
		}
	});
	const collections = () => t.run((ctx) => ctx.db.query('collections').collect());

	const before = await collections();
	await t.mutation(internal.collections.dropDateCreated, {});
	const after = await collections();
	expect(after).toEqual(before.map(({ dateCreated: _, ...collection }) => collection));
	expect(after.map(({ name }) => name)).toEqual(['new', 'old', 'older']);

	await t.mutation(internal.collections.dropDateCreated, {});
	expect(await collections()).toEqual(after);
});

test('deleting a collection drops its memberships without touching members', async () => {
	vi.useFakeTimers();
	const t = newTest();
	const { token } = await makeUser(t);
	const doomed = await t.mutation(api.collections.create, { name: 'doomed', token });
	const kept = await t.mutation(api.collections.create, { name: 'kept', token });
	const itemIds = await Promise.all(
		['one', 'two'].map((content) =>
			t.mutation(api.items.add, { type: 'text', content, collections: [doomed, kept], token })
		)
	);
	const before = await t.run((ctx) => Promise.all(itemIds.map((id) => ctx.db.get(id))));

	vi.advanceTimersByTime(1000);
	await t.mutation(api.collections.remove, { id: doomed, token });

	await t.run(async (ctx) => {
		for (const [i, id] of itemIds.entries()) {
			const item = await ctx.db.get(id);
			expect(item?.collections).toEqual([kept]);
			expect(item?.dateModified).toBe(before[i]?.dateModified);
		}
		const positions = await ctx.db.query('itemCollectionPositions').collect();
		expect(positions.map((p) => p.collectionId)).toEqual([kept, kept]);
		expect(await ctx.db.get(doomed)).toBeNull();
		expect((await ctx.db.get(kept))?.itemCount).toBe(2);
	});
	vi.useRealTimers();
});

test('deleting an item drops it from each of its collections', async () => {
	vi.useFakeTimers();
	const t = newTest();
	const { token } = await makeUser(t);
	const [a, b] = await Promise.all(
		['a', 'b'].map((name) => t.mutation(api.collections.create, { name, token }))
	);
	const doomed = await t.mutation(api.items.add, {
		type: 'text',
		content: 'doomed',
		collections: [a, b],
		token
	});
	const kept = await t.mutation(api.items.add, {
		type: 'text',
		content: 'kept',
		collections: [a],
		token
	});

	await t.mutation(api.items.remove, { id: doomed, token });

	await t.run(async (ctx) => {
		expect(await ctx.db.get(doomed)).toBeNull();
		expect((await ctx.db.get(a))?.itemCount).toBe(1);
		expect((await ctx.db.get(b))?.itemCount).toBe(0);
		const positions = await ctx.db.query('itemCollectionPositions').collect();
		expect(positions.map((p) => [p.itemId, p.collectionId])).toEqual([[kept, a]]);
	});
	vi.useRealTimers();
});

test('addManyToCollection adds every item once, and only the caller’s', async () => {
	vi.useFakeTimers();
	const t = newTest();
	const { token } = await makeUser(t);
	const collectionId = await t.mutation(api.collections.create, { name: 'c', token });
	const add = (content: string, collections: Id<'collections'>[] = []) =>
		t.mutation(api.items.add, { type: 'text', content, collections, token });
	const member = await add('member', [collectionId]);
	const [x, y] = [await add('x'), await add('y')];

	await t.mutation(api.items.addManyToCollection, {
		itemIds: [x, member, y],
		collectionId,
		token
	});
	await t.run(async (ctx) => {
		expect((await ctx.db.get(collectionId))?.itemCount).toBe(3);
		for (const id of [x, y, member]) {
			expect((await ctx.db.get(id))?.collections).toEqual([collectionId]);
		}
	});
	const listed = await t.query(api.items.listByCollection, { collectionId, token });
	expect(listed.map((i) => i._id)).toEqual([y, x, member]);

	// Another user's item or collection refuses the whole batch
	const other = await makeUser(t, 'b');
	const theirs = await insertUrlItem(t, other.userId, { url: 'https://b.co' });
	const theirCollection = await t.mutation(api.collections.create, {
		name: 'theirs',
		token: other.token
	});
	const z = await add('z');
	await expect(
		t.mutation(api.items.addManyToCollection, { itemIds: [z, theirs], collectionId, token })
	).rejects.toThrow('item not found');
	await expect(
		t.mutation(api.items.addManyToCollection, {
			itemIds: [z],
			collectionId: theirCollection,
			token
		})
	).rejects.toThrow('collection not found');
	expect((await t.run((ctx) => ctx.db.get(z)))?.collections).toEqual([]);
	expect((await t.run((ctx) => ctx.db.get(collectionId)))?.itemCount).toBe(3);

	await expect(
		t.mutation(api.items.addManyToCollection, {
			itemIds: Array.from({ length: 101 }, () => z),
			collectionId,
			token
		})
	).rejects.toThrow('too many items at once');
	vi.useRealTimers();
});

test('collection items keep manual order, which also breaks sort ties', async () => {
	const t = newTest();
	const { token } = await makeUser(t);
	const collectionId = await t.mutation(api.collections.create, { name: 'c', token });
	const add = (title: string) =>
		t.mutation(api.items.add, { type: 'text', title, collections: [collectionId], token });
	const [a, b, c] = [await add('same'), await add('same'), await add('first')];
	const list = async (sortBy?: 'titleAsc') =>
		(await t.query(api.items.listByCollection, { collectionId, sortBy, token })).map((i) => i._id);

	// New members go on top
	expect(await list()).toEqual([c, b, a]);
	const [top] = await t.query(api.items.listByCollection, { collectionId, token });
	await t.mutation(api.itemCollectionPositions.reorderItem, {
		itemId: a,
		collectionId,
		newPosition: generateKeyBetween(null, top.position),
		token
	});
	expect(await list()).toEqual([a, c, b]);
	expect(await list('titleAsc')).toEqual([c, a, b]);

	await t.mutation(api.items.removeFromCollection, { itemId: a, collectionId, token });
	await expect(
		t.mutation(api.itemCollectionPositions.reorderItem, {
			itemId: a,
			collectionId,
			newPosition: 'a0',
			token
		})
	).rejects.toThrow('item is not in this collection');
});

test('backfilled fonts are stored and searchable without touching the image', async () => {
	const t = newTest();
	const itemId = await t.run(async (ctx) => {
		const userId = await ctx.db.insert('users', { username: 'a', passwordHash: 'unused' });
		return ctx.db.insert('items', {
			userId,
			type: 'url',
			url: 'https://klim.co.nz',
			title: 'Klim',
			imageKey: 'screenshots/klim.webp',
			collections: [],
			dateAdded: 0,
			dateModified: 0
		});
	});
	await t.mutation(internal.screenshots.setFonts, {
		items: [{ itemId, fonts: [{ family: 'SOEHNE', internalName: 'Söhne' }] }]
	});
	const item = await t.run((ctx) => ctx.db.get(itemId));
	expect(item?.fonts).toEqual([{ family: 'SOEHNE', internalName: 'Söhne' }]);
	expect(item?.imageKey).toBe('screenshots/klim.webp');
	expect(item?.searchText).toBe('Klim https://klim.co.nz fontsohne Söhne Sohne soehne');
});

test('findByUrl finds the caller’s saved copies of a page, newest first', async () => {
	const t = newTest();
	const { userId, token } = await makeUser(t);
	const other = await t.run((ctx) =>
		ctx.db.insert('users', { username: 'b', passwordHash: 'unused' })
	);
	const insert = (owner: Id<'users'>, type: 'url' | 'image', url: string, dateAdded: number) =>
		t.run((ctx) =>
			ctx.db.insert('items', {
				userId: owner,
				type,
				url,
				normUrl: normalizeUrl(url),
				collections: [],
				dateAdded,
				dateModified: dateAdded
			})
		);
	const older = await insert(userId, 'url', 'https://www.example.com/work/', 1);
	const newer = await insert(userId, 'url', 'https://example.com/work?utm_source=x', 2);
	await insert(userId, 'image', 'https://example.com/work', 3); // Saved from the page
	await insert(other, 'url', 'https://example.com/work', 4);

	const found = await t.query(api.items.findByUrl, { url: 'http://example.com/work#top', token });
	expect(found.map((item) => item._id)).toEqual([newer, older]);
	expect(await t.query(api.items.findByUrl, { url: 'https://example.com/other', token })).toEqual(
		[]
	);
	expect(await t.query(api.items.findByUrl, { url: 'example.com/work', token })).toEqual([]);
});
