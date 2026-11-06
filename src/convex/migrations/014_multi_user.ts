import { v } from 'convex/values';
import { internalAction, internalMutation, internalQuery } from '../_generated/server';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { hashPassword, hashToken, normalizeUsername } from '../lib/auth';

const BATCH_SIZE = 200;
const ownedTable = v.union(
	v.literal('items'),
	v.literal('collections'),
	v.literal('viewPreferences')
);

// Create the owner account and hand it every existing row. The old shared
// CONVEX_WRITE_TOKEN becomes one of the owner's sessions, so the browser
// extension keeps working. Backfills run as scheduled batches; rerun-safe.
// Requires userId to be optional in the schema while it runs (widen →
// backfill → narrow, see reference/multi-user.md).
//
// Run: npx convex run migrations/014_multi_user:migrateToMultiUser '{"username": "...", "password": "..."}'
export const migrateToMultiUser = internalAction({
	args: { username: v.string(), password: v.string() },
	handler: async (ctx, args): Promise<{ userId: Id<'users'> }> => {
		const ownerToken = process.env.CONVEX_WRITE_TOKEN;
		if (!ownerToken) throw new Error('CONVEX_WRITE_TOKEN is not set');
		const userId: Id<'users'> = await ctx.runMutation(
			internal.migrations['014_multi_user'].createOwner,
			{
				username: normalizeUsername(args.username),
				passwordHash: await hashPassword(args.password),
				tokenHash: await hashToken(ownerToken)
			}
		);
		return { userId };
	}
});

export const createOwner = internalMutation({
	args: { username: v.string(), passwordHash: v.string(), tokenHash: v.string() },
	handler: async (ctx, args) => {
		const existing = await ctx.db
			.query('users')
			.withIndex('by_username', (q) => q.eq('username', args.username))
			.unique();
		const userId =
			existing?._id ??
			(await ctx.db.insert('users', {
				username: args.username,
				passwordHash: args.passwordHash
			}));

		const session = await ctx.db
			.query('sessions')
			.withIndex('by_tokenHash', (q) => q.eq('tokenHash', args.tokenHash))
			.unique();
		if (!session) await ctx.db.insert('sessions', { userId, tokenHash: args.tokenHash });

		for (const table of ['items', 'collections', 'viewPreferences'] as const) {
			await ctx.scheduler.runAfter(0, internal.migrations['014_multi_user'].backfillUserId, {
				table,
				userId,
				cursor: null
			});
		}
		return userId;
	}
});

export const backfillUserId = internalMutation({
	args: { table: ownedTable, userId: v.id('users'), cursor: v.union(v.string(), v.null()) },
	handler: async (ctx, args) => {
		const { page, isDone, continueCursor } = await ctx.db
			.query(args.table)
			.paginate({ numItems: BATCH_SIZE, cursor: args.cursor });

		for (const doc of page) {
			if (!doc.userId) await ctx.db.patch(doc._id, { userId: args.userId });
		}

		if (!isDone) {
			await ctx.scheduler.runAfter(0, internal.migrations['014_multi_user'].backfillUserId, {
				...args,
				cursor: continueCursor
			});
		}
	}
});

// Rows still missing a userId; all zeros means it's safe to narrow the schema.
// Run: npx convex run migrations/014_multi_user:countUnowned
export const countUnowned = internalQuery({
	args: {},
	handler: async (ctx) => {
		const counts: Record<string, number> = {};
		for (const table of ['items', 'collections', 'viewPreferences'] as const) {
			counts[table] = 0;
			for await (const doc of ctx.db.query(table)) {
				if (!doc.userId) counts[table]++;
			}
		}
		return counts;
	}
});
