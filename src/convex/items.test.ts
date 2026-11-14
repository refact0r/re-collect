// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { expect, test, vi } from 'vitest';
import { api, internal } from './_generated/api';
import schema from './schema';
import { hashToken } from './lib/auth';

const modules = import.meta.glob('./**/*.ts');

test('per-save overrides replace the collection’s ingestion defaults', async () => {
	vi.useFakeTimers(); // Keep the scheduled tagging actions from running
	const t = convexTest(schema, modules);
	const token = 'a-token';
	const userId = await t.run(async (ctx) => {
		const userId = await ctx.db.insert('users', { username: 'a', passwordHash: 'unused' });
		await ctx.db.insert('sessions', { userId, tokenHash: await hashToken(token) });
		await ctx.db.insert('uploads', { userId, key: 'key-1' });
		await ctx.db.insert('uploads', { userId, key: 'key-2' });
		return userId;
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
	const t = convexTest(schema, modules);
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

test('backfilled fonts are stored and searchable without touching the image', async () => {
	const t = convexTest(schema, modules);
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
