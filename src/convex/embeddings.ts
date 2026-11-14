import { v } from 'convex/values';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { action, internalMutation, internalQuery, type MutationCtx } from './_generated/server';
import { EMBEDDING_MODEL, embedQuery } from './lib/embedder';

// The database side of item embeddings; the embedding run itself is
// taggingActions.embedItem (Node, for sharp). One row per item in
// itemEmbeddings, written once its image or text is final.

// Asks for an item's embedding to be brought up to date. Cheap to over-call:
// the run skips items that aren't ready and inputs it has already embedded, so
// every write that could change what an item embeds as just calls this.
export async function scheduleEmbedding(ctx: MutationCtx, itemId: Id<'items'>, delayMs = 0) {
	await ctx.scheduler.runAfter(delayMs, internal.taggingActions.embedItem, { itemId });
}

export async function deleteItemEmbeddings(ctx: MutationCtx, itemId: Id<'items'>) {
	const rows = await ctx.db
		.query('itemEmbeddings')
		.withIndex('by_item', (q) => q.eq('itemId', itemId))
		.collect();
	for (const row of rows) await ctx.db.delete(row._id);
}

export const getItemForEmbedding = internalQuery({
	args: { itemId: v.id('items') },
	handler: async (ctx, { itemId }) => {
		const item = await ctx.db.get(itemId);
		if (!item) return null;
		const existing = await ctx.db
			.query('itemEmbeddings')
			.withIndex('by_item', (q) => q.eq('itemId', itemId))
			.first();
		return { item, embeddedKey: existing?.model === EMBEDDING_MODEL ? existing.inputKey : null };
	}
});

export const saveEmbedding = internalMutation({
	args: { itemId: v.id('items'), inputKey: v.string(), embedding: v.array(v.float64()) },
	handler: async (ctx, { itemId, inputKey, embedding }) => {
		// Deleted while the run was out
		const item = await ctx.db.get(itemId);
		if (!item) return;
		await deleteItemEmbeddings(ctx, itemId);
		await ctx.db.insert('itemEmbeddings', {
			itemId,
			userId: item.userId,
			model: EMBEDDING_MODEL,
			inputKey,
			embedding
		});
	}
});

// Embeds every item without a current embedding (all of them after a model
// change), a page per transaction, with the runs spread out to stay under the
// Workers AI rate limit.
// Run with `npx convex run embeddings:backfill` (add --prod for production)
export const backfill = internalMutation({
	args: { cursor: v.optional(v.string()), scheduled: v.optional(v.number()) },
	handler: async (ctx, args) => {
		const { page, isDone, continueCursor } = await ctx.db
			.query('items')
			.paginate({ numItems: 100, cursor: args.cursor ?? null });
		let scheduled = args.scheduled ?? 0;
		for (const item of page) {
			const existing = await ctx.db
				.query('itemEmbeddings')
				.withIndex('by_item', (q) => q.eq('itemId', item._id))
				.first();
			if (existing?.model === EMBEDDING_MODEL) continue;
			await scheduleEmbedding(ctx, item._id, scheduled * 100);
			scheduled++;
		}
		if (!isDone) {
			await ctx.scheduler.runAfter(0, internal.embeddings.backfill, {
				cursor: continueCursor,
				scheduled
			});
		} else {
			console.log(`embeddings backfill: ${scheduled} items scheduled`);
		}
	}
});

// How many nearest neighbours a search returns: enough to re-rank the keyword
// matches and offer the closest of the rest
const SEARCH_CANDIDATES = 64;

// The caller's items nearest a text query, best first. Scores sit in a narrow
// band whatever the query (a nonsense one scores like a good one), so callers
// get ranks, not a relevance cutoff.
export const search = action({
	args: { token: v.string(), query: v.string() },
	handler: async (ctx, { token, query }): Promise<Id<'items'>[]> => {
		const userId = await ctx.runQuery(internal.users.userForToken, { token });
		if (!query.trim()) return [];
		const hits = await ctx.vectorSearch('itemEmbeddings', 'by_embedding', {
			vector: await embedQuery(query),
			limit: SEARCH_CANDIDATES,
			filter: (q) => q.eq('userId', userId)
		});
		const itemIds = await ctx.runQuery(internal.embeddings.itemIdsForHits, {
			ids: hits.map((hit) => hit._id)
		});
		return itemIds.filter((id) => id !== null);
	}
});

// Vector search hits back to item ids, in hit order; null for a stale model's row
export const itemIdsForHits = internalQuery({
	args: { ids: v.array(v.id('itemEmbeddings')) },
	handler: async (ctx, { ids }): Promise<(Id<'items'> | null)[]> => {
		const rows = await Promise.all(ids.map((id) => ctx.db.get(id)));
		return rows.map((row) => (row?.model === EMBEDDING_MODEL ? row.itemId : null));
	}
});
