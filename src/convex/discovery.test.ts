// @vitest-environment edge-runtime
import type { FunctionArgs } from 'convex/server';
import { expect, test, vi } from 'vitest';
import { api, internal } from './_generated/api';
import { hashToken } from './lib/auth';
import { normalizeUrl } from './lib/urls';
import { newTest, type Test } from './testing.helpers';

async function setup() {
	const t = newTest();
	const tokens = { a: 'a-token', b: 'b-token' };
	await t.run(async (ctx) => {
		for (const [username, token] of Object.entries(tokens)) {
			const userId = await ctx.db.insert('users', { username, passwordHash: 'unused' });
			await ctx.db.insert('sessions', { userId, tokenHash: await hashToken(token) });
		}
		for (const [sourceKey, url, publishedAt] of [
			['awwwards', 'https://saved.example/?ref=awwwards', 3],
			['awwwards', 'https://fresh.example/', 2],
			['seesaw', 'https://other.example/', 1]
		] as const) {
			await ctx.db.insert('discoveryCandidates', {
				sourceKey,
				externalId: url,
				normUrl: normalizeUrl(url),
				kind: 'site',
				url,
				imageUrl: 'https://img.example/a.jpg',
				publishedAt
			});
		}
	});
	const feedUrls = async (token: string) =>
		(await t.query(api.discovery.feed, { limit: 10, token })).candidates.map((c) => c.url);
	return { t, tokens, feedUrls };
}

test("the feed leaves out links already in the user's library, and only theirs", async () => {
	const { t, tokens, feedUrls } = await setup();
	await t.mutation(api.items.add, {
		type: 'text',
		content: 'saved',
		url: 'https://www.saved.example',
		token: tokens.a
	});

	// The saved link still holds Awwwards' first round, so Seesaw's card leads
	expect(await feedUrls(tokens.a)).toEqual(['https://other.example/', 'https://fresh.example/']);
	expect(await feedUrls(tokens.b)).toHaveLength(3);
});

test('a turned-off source leaves only that user’s feed', async () => {
	const { t, tokens, feedUrls } = await setup();
	await t.mutation(api.discovery.setSourceHidden, {
		key: 'awwwards',
		hidden: true,
		token: tokens.a
	});

	expect(await feedUrls(tokens.a)).toEqual(['https://other.example/']);
	expect(await feedUrls(tokens.b)).toHaveLength(3);

	await t.mutation(api.discovery.setSourceHidden, {
		key: 'awwwards',
		hidden: false,
		token: tokens.a
	});
	expect(await feedUrls(tokens.a)).toHaveLength(3);
});

const entry = (externalId: string, url: string, publishedAt: number) => ({
	externalId,
	kind: 'site' as const,
	url,
	imageUrl: 'https://img.example/b.jpg',
	publishedAt
});

test('a link two sources carry shows once, and still shows with the first one off', async () => {
	const { t, tokens, feedUrls } = await setup();
	const added = await t.mutation(internal.discovery.ingest, {
		sourceKey: 'seesaw',
		candidates: [entry('fresh', 'https://www.fresh.example', 0)]
	});
	expect(added).toBe(1);

	expect(await feedUrls(tokens.a)).toEqual([
		'https://saved.example/?ref=awwwards',
		'https://other.example/',
		'https://fresh.example/'
	]);

	await t.mutation(api.discovery.setSourceHidden, {
		key: 'awwwards',
		hidden: true,
		token: tokens.a
	});
	expect(await feedUrls(tokens.a)).toEqual(['https://other.example/', 'https://www.fresh.example']);
});

test('ingest stores each source entry once, and only http(s) links and media', async () => {
	const { t } = await setup();
	const ingest = (candidates: FunctionArgs<typeof internal.discovery.ingest>['candidates']) =>
		t.mutation(internal.discovery.ingest, { sourceKey: 'seesaw', candidates });

	expect(
		await ingest([
			entry('script', 'javascript:alert(1)', 0),
			{ ...entry('image', 'https://ok.example/', 0), imageUrl: 'data:image/png;base64,AAAA' },
			{ ...entry('video', 'https://video.example/', 0), videoUrl: 'javascript:alert(1)' }
		])
	).toBe(1);
	expect(await ingest([entry('video', 'https://video.example/', 0)])).toBe(0);

	const stored = await t.run((ctx) =>
		ctx.db
			.query('discoveryCandidates')
			.withIndex('by_source_externalId', (q) =>
				q.eq('sourceKey', 'seesaw').eq('externalId', 'video')
			)
			.unique()
	);
	expect(stored?.url).toBe('https://video.example/');
	expect(stored?.videoUrl).toBeUndefined();
});

const DAY = 24 * 60 * 60 * 1000;

// Candidates of one source published at the given times, stored at the current (fake) time
const store = (t: Test, sourceKey: string, published: number[]) =>
	t.run(async (ctx) => {
		for (const publishedAt of published) {
			const url = `https://${publishedAt}.example/`;
			await ctx.db.insert('discoveryCandidates', {
				sourceKey,
				externalId: `${publishedAt}`,
				normUrl: normalizeUrl(url),
				kind: 'site',
				url,
				imageUrl: 'https://img.example/a.jpg',
				publishedAt
			});
		}
	});
const range = (from: number, to: number) =>
	Array.from({ length: to - from + 1 }, (_, i) => from + i);

test('expiry drops month-old candidates past their source’s newest 300, and a removed source’s', async () => {
	vi.useFakeTimers();
	const t = newTest();
	vi.setSystemTime(Date.now() - 40 * DAY);
	await store(t, 'seesaw', range(1, 620));
	await store(t, 'awwwards', range(1, 10));
	vi.setSystemTime(Date.now() + 40 * DAY);
	// Stored lately, though published before the rest
	await store(t, 'seesaw', [0]);
	await store(t, 'arena:no-longer-listed', range(1, 3));

	const left = () =>
		t.run(async (ctx) => {
			const rows = await ctx.db.query('discoveryCandidates').collect();
			const bySource: Record<string, number[]> = {};
			for (const row of rows) (bySource[row.sourceKey] ??= []).push(row.publishedAt);
			for (const list of Object.values(bySource)) list.sort((a, b) => a - b);
			return bySource;
		});
	const expire = async () => {
		await t.mutation(internal.discovery.expireCandidates, {});
		await t.finishAllScheduledFunctions(vi.runAllTimers);
	};

	await expire();
	const expected = { seesaw: [0, ...range(321, 620)], awwwards: range(1, 10) };
	expect(await left()).toEqual(expected);

	await expire();
	expect(await left()).toEqual(expected);
	vi.useRealTimers();
});
