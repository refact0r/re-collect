/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import rateLimiter from '@convex-dev/rate-limiter/test';
import workpool from '@convex-dev/workpool/test';
import { vi } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { hashToken } from './lib/auth';
import { EMBEDDING_MODEL } from './lib/embedder';
import { r2 } from './r2';
import schema from './schema';

// Test-only; the second dot in the file name keeps Convex from deploying it.

// A convex-test backend with every workpool and the rate limiter registered,
// so any function that queues work (tagging, captures, embeddings) can run
export function newTest() {
	const t = convexTest(schema, import.meta.glob('./**/*.ts'));
	for (const pool of ['taggingPool', 'screenshotPool', 'embeddingPool', 'variantPool'])
		workpool.register(t, pool);
	rateLimiter.register(t);
	return t;
}

export type Test = ReturnType<typeof newTest>;

// A user with one session (token `<username>-token`), skipping the slow password hash
export async function makeUser(t: Test, username = 'a') {
	const token = `${username}-token`;
	const userId = await t.run(async (ctx) => {
		const userId = await ctx.db.insert('users', { username, passwordHash: 'unused' });
		await ctx.db.insert('sessions', { userId, tokenHash: await hashToken(token) });
		return userId;
	});
	return { userId, token };
}

// The user's whole library as items.list pages it, newest first
export async function listItems(t: Test, token: string) {
	const { page, isDone } = await t.query(api.items.list, {
		paginationOpts: { numItems: 1000, cursor: null },
		token
	});
	if (!isDone) throw new Error('library bigger than one test page');
	return page;
}

// An item's embedding row and its vector, as saveEmbedding writes them
export async function insertEmbedding(
	ctx: MutationCtx,
	row: { itemId: Id<'items'>; userId: Id<'users'>; inputKey: string; embedding: number[] },
	model = EMBEDDING_MODEL
) {
	const { embedding, ...fields } = row;
	const vectorId = await ctx.db.insert('embeddingVectors', { userId: row.userId, embedding });
	return ctx.db.insert('itemEmbeddings', { ...fields, model, vectorId });
}

// R2 credentials to sign with, a fake bucket URL to read from and stubbed
// deletes; returns the deleteObject spy
export function stubR2() {
	Object.assign(r2.config, {
		bucket: 'images',
		endpoint: 'https://account.r2.cloudflarestorage.com',
		accessKeyId: 'AKIDEXAMPLE',
		secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY'
	});
	vi.spyOn(r2, 'getUrl').mockImplementation(async (key) => `https://bucket.example/${key}`);
	return vi.spyOn(r2, 'deleteObject').mockResolvedValue();
}
