// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';
import { hashToken } from './lib/auth';
import { normalizeUrl } from './lib/urls';

const modules = import.meta.glob('./**/*.ts');

async function setup() {
	const t = convexTest(schema, modules);
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
