// @vitest-environment edge-runtime
import type { FunctionArgs } from 'convex/server';
import { expect, test, vi } from 'vitest';
import { api, internal } from './_generated/api';
import { SOURCES } from './lib/discoverySources';
import { normalizeUrl } from './lib/urls';
import { makeUser, newTest, type Test } from './testing.helpers';

async function setup() {
	const t = newTest();
	const tokens = { a: (await makeUser(t, 'a')).token, b: (await makeUser(t, 'b')).token };
	await t.run(async (ctx) => {
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

test('each page is the start of the whole deal, reading deeper when saved links use up the first read', async () => {
	const t = newTest();
	const { token } = await makeUser(t, 'a');
	await store(t, 'awwwards', range(101, 110));
	await store(t, 'seesaw', range(1, 10));
	// Two channels of one Are.na group share its slot
	await store(t, 'arena:websites-skgmukjoccg', range(51, 55));
	await store(t, 'arena:interesting-web-design-and-ux', [60]);
	for (const n of range(105, 110))
		await t.mutation(api.items.add, {
			type: 'text',
			content: 'saved',
			url: `https://${n}.example`,
			token
		});

	// Round by round: Awwwards, then the Are.na group, then Seesaw
	const whole = [60, 10, 55, 9, 54, 8, 53, 7, 52, 6, 51, 5, 104, 4, 103, 3, 102, 2, 101, 1];
	for (const limit of range(1, whole.length + 1)) {
		const page = await t.query(api.discovery.feed, { limit, token });
		expect(page.candidates.map((c) => c.url)).toEqual(
			whole.slice(0, limit).map((n) => `https://${n}.example/`)
		);
		expect(page.more).toBe(limit < whole.length);
	}
});

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

const rss = (ids: string[], host: string) =>
	`<rss><channel>${ids
		.map(
			(id, i) =>
				`<item><title>${id}</title><link>https://${host}/sites/${id}</link><guid>${id}</guid>` +
				`<pubDate>${new Date(Date.UTC(2026, 10, 1, 0, 0, ids.length - i)).toUTCString()}</pubDate>` +
				`<description><![CDATA[<img src="https://img.example/${id}.jpg">]]></description></item>`
		)
		.join('')}</channel></rss>`;

test('a poll keeps going past a failing source, and a gallery out of time picks up where it left off', async () => {
	vi.useFakeTimers();
	const t = newTest();
	// Awwwards' detail pages take two minutes each, so a poll gets through three;
	// One Page Love is down, and so is everything else but Siteinspire
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string) => {
			if (url === 'https://www.awwwards.com/feed/')
				return new Response(rss(['a1', 'a2', 'a3', 'a4', 'a5'], 'www.awwwards.com'));
			if (url === 'https://www.siteinspire.com/websites/feed')
				return new Response(rss(['s1'], 'www.siteinspire.com'));
			const detail = url.match(/^https:\/\/www\.awwwards\.com\/sites\/(\w+)$/);
			if (!detail) return new Response(null, { status: 500 });
			vi.setSystemTime(Date.now() + 2 * 60 * 1000);
			return new Response(`<a class="toolbar-bts__item" href="https://${detail[1]}.example/">`);
		})
	);
	const poll = async () => {
		await t.mutation(internal.discovery.pollAll, {});
		await t.finishAllScheduledFunctions(vi.runAllTimers);
		return t.run(async (ctx) => ({
			urls: (await ctx.db.query('discoveryCandidates').collect()).map((c) => c.url).sort(),
			errors: Object.fromEntries(
				(await ctx.db.query('discoverySources').collect()).map((s) => [s.key, s.lastError ?? null])
			)
		}));
	};

	const first = await poll();
	expect(first.urls).toEqual([
		'https://a1.example/',
		'https://a2.example/',
		'https://a3.example/',
		'https://www.siteinspire.com/sites/s1'
	]);
	expect(Object.keys(first.errors).sort()).toEqual(SOURCES.map((s) => s.key).sort());
	expect(first.errors.awwwards).toBe('out of time, 2 entries left for the next poll');
	expect(first.errors.onepagelove).toMatch(/500/);
	expect(first.errors.siteinspire).toBeNull();

	const second = await poll();
	expect(second.urls).toEqual([
		...['a1', 'a2', 'a3', 'a4', 'a5'].map((id) => `https://${id}.example/`),
		'https://www.siteinspire.com/sites/s1'
	]);
	expect(second.errors.awwwards).toBeNull();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});
