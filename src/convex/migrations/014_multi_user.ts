import { v } from 'convex/values';
import { internalMutation, internalQuery } from '../_generated/server';
import { internal } from '../_generated/api';
import { OWNER_TOKEN_IDENTIFIER } from '../lib/auth';

const BATCH_SIZE = 200;
const ownedTable = v.union(
	v.literal('items'),
	v.literal('collections'),
	v.literal('viewPreferences')
);

// Create the owner user (the identity the shared write token resolves to) and
// hand it every existing row. Backfills run as scheduled batches; rerun-safe.
// Requires userId to be optional in the schema while it runs (widen → backfill
// → narrow, see reference/multi-user.md).
//
// Run: npx convex run migrations/014_multi_user:migrateToMultiUser
export const migrateToMultiUser = internalMutation({
	args: { name: v.optional(v.string()) },
	handler: async (ctx, args) => {
		const existing = await ctx.db
			.query('users')
			.withIndex('by_tokenIdentifier', (q) => q.eq('tokenIdentifier', OWNER_TOKEN_IDENTIFIER))
			.unique();
		const userId =
			existing?._id ??
			(await ctx.db.insert('users', {
				name: args.name ?? 'owner',
				tokenIdentifier: OWNER_TOKEN_IDENTIFIER
			}));

		for (const table of ['items', 'collections', 'viewPreferences'] as const) {
			await ctx.scheduler.runAfter(0, internal.migrations['014_multi_user'].backfillUserId, {
				table,
				userId,
				cursor: null
			});
		}
		return { userId };
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
