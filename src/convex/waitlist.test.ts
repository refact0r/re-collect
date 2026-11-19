// @vitest-environment edge-runtime
import { expect, test } from 'vitest';
import { api } from './_generated/api';
import { newTest, type Test } from './testing.helpers';
import { JOIN_BURST } from './lib/rateLimits';
import { WAITLIST_CEILING } from './waitlist';

const emails = (t: Test) =>
	t.run(async (ctx) => (await ctx.db.query('waitlist').collect()).map((row) => row.email));

test('joining stores the normalized email once', async () => {
	const t = newTest();
	await t.mutation(api.waitlist.join, { email: '  Someone@Example.com ' });
	await t.mutation(api.waitlist.join, { email: 'someone@example.com' });
	expect(await emails(t)).toEqual(['someone@example.com']);
	const counter = await t.run((ctx) => ctx.db.query('waitlistCount').first());
	expect(counter?.count).toBe(1);
});

test('an invalid email is rejected', async () => {
	const t = newTest();
	for (const email of ['', 'nope', 'a@b', 'a b@c.com', `${'a'.repeat(250)}@b.com`]) {
		await expect(t.mutation(api.waitlist.join, { email })).rejects.toThrow(/email/);
	}
	expect(await emails(t)).toEqual([]);
});

test('a filled honeypot stores nothing', async () => {
	const t = newTest();
	await t.mutation(api.waitlist.join, { email: 'bot@example.com', website: 'http://spam' });
	expect(await emails(t)).toEqual([]);
});

test('a full list takes no new emails', async () => {
	const t = newTest();
	await t.run(async (ctx) => {
		await ctx.db.insert('waitlist', { email: 'early@example.com' });
		await ctx.db.insert('waitlistCount', { count: WAITLIST_CEILING });
	});
	await expect(t.mutation(api.waitlist.join, { email: 'late@example.com' })).rejects.toThrow(
		/full/
	);
	// Already on it answers the same, so a full list doesn't reveal who is
	await expect(t.mutation(api.waitlist.join, { email: 'early@example.com' })).rejects.toThrow(
		/full/
	);
	expect(await emails(t)).toEqual(['early@example.com']);
});

test('joins past the burst are turned away', async () => {
	const t = newTest();
	for (let i = 0; i < JOIN_BURST; i++) {
		await t.mutation(api.waitlist.join, { email: `person${i}@example.com` });
	}
	await expect(t.mutation(api.waitlist.join, { email: 'one@more.com' })).rejects.toThrow(
		/try again/
	);
	expect(await emails(t)).toHaveLength(JOIN_BURST);
});
