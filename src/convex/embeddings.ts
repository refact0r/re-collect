import { v } from 'convex/values';
import { Workpool } from '@convex-dev/workpool';
import { components, internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import {
	action,
	internalMutation,
	internalQuery,
	type MutationCtx,
	type QueryCtx
} from './_generated/server';
import { markMapStale } from './embeddingMap';
import {
	EMBEDDING_MODEL,
	embedQuery,
	embeddingInput,
	embeddingToMake,
	inputKey,
	isImageKey
} from './lib/embedder';
import { limitUser } from './lib/rateLimits';

// The database side of item embeddings; the embedding run itself is
// taggingActions.embedItem (Node, for sharp).

// Bounds the Workers AI calls a burst of adds or a backfill makes at once, and
// retries the ones that may pass later (rate limits, server errors, timeouts)
// with backoff; embedItem marks every other failure final.
const embeddingPool = new Workpool(components.embeddingPool, {
	maxParallelism: 5,
	retryActionsByDefault: true,
	defaultRetryBehavior: { maxAttempts: 4, initialBackoffMs: 2000, base: 4 }
});

// Brings an item's embedding up to date. Cheap to over-call: the run skips items
// that aren't ready and inputs it has already embedded.
export async function scheduleEmbedding(ctx: MutationCtx, itemId: Id<'items'>) {
	await embeddingPool.enqueueAction(ctx, internal.taggingActions.embedItem, { itemId });
}

// Deletes an embedding row with its vector
export async function deleteEmbedding(ctx: MutationCtx, row: Doc<'itemEmbeddings'>) {
	await ctx.db.delete(row.vectorId);
	await ctx.db.delete(row._id);
}

export async function deleteItemEmbeddings(ctx: MutationCtx, itemId: Id<'items'>) {
	const rows = await ctx.db
		.query('itemEmbeddings')
		.withIndex('by_item', (q) => q.eq('itemId', itemId))
		.collect();
	for (const row of rows) await deleteEmbedding(ctx, row);
	if (rows.some((row) => isImageKey(row.inputKey))) await markMapStale(ctx, rows[0].userId);
}

const findEmbedding = (ctx: QueryCtx, itemId: Id<'items'>) =>
	ctx.db
		.query('itemEmbeddings')
		.withIndex('by_item', (q) => q.eq('itemId', itemId))
		.first();

// The input key of the item's current-model embedding, if it has one
async function embeddedKey(ctx: QueryCtx, itemId: Id<'items'>) {
	const row = await findEmbedding(ctx, itemId);
	return row?.model === EMBEDDING_MODEL ? row.inputKey : null;
}

// What embedItem is to embed for the item now, or null (deleted, not ready, or done)
export const embeddingJob = internalQuery({
	args: { itemId: v.id('items') },
	handler: async (ctx, { itemId }) => {
		const item = await ctx.db.get(itemId);
		return item && embeddingToMake(item, await embeddedKey(ctx, itemId));
	}
});

export const saveEmbedding = internalMutation({
	args: { itemId: v.id('items'), inputKey: v.string(), embedding: v.array(v.float64()) },
	handler: async (ctx, { itemId, inputKey: key, embedding }) => {
		// Deleted, or changed since the run read it (the change scheduled a newer
		// run, which a slow older one mustn't overwrite)
		const item = await ctx.db.get(itemId);
		const input = item && embeddingInput(item);
		if (!item || !input || (await inputKey(input)) !== key) return;

		const { userId } = item;
		const fields = { model: EMBEDDING_MODEL, inputKey: key };
		const existing = await findEmbedding(ctx, itemId);
		// Patched in place, so the row keeps its spot in by_user for a map read
		// paging past it
		if (existing) {
			await ctx.db.patch(existing.vectorId, { embedding });
			await ctx.db.patch(existing._id, fields);
		} else {
			const vectorId = await ctx.db.insert('embeddingVectors', { userId, embedding });
			await ctx.db.insert('itemEmbeddings', { itemId, userId, ...fields, vectorId });
		}
		// A text embedding leaves the map as it was, unless it replaced an image one
		if (isImageKey(key) || (existing && isImageKey(existing.inputKey))) {
			await markMapStale(ctx, userId);
		}
	}
});

// Embeds every item whose embedding is missing or out of date (all of them
// after a model change) and deletes the embeddings of items with AI off, a page
// per transaction; the pool paces the runs.
// Run with `npx convex run embeddings:backfill` (add --prod for production)
export const backfill = internalMutation({
	args: { cursor: v.optional(v.string()), scheduled: v.optional(v.number()) },
	handler: async (ctx, args) => {
		const { page, isDone, continueCursor } = await ctx.db
			.query('items')
			.paginate({ numItems: 100, cursor: args.cursor ?? null });
		let scheduled = args.scheduled ?? 0;
		for (const item of page) {
			if (item.taggingMode === 'none') {
				await deleteItemEmbeddings(ctx, item._id);
				continue;
			}
			if (!(await embeddingToMake(item, await embeddedKey(ctx, item._id)))) continue;
			await scheduleEmbedding(ctx, item._id);
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
		await limitUser(ctx, 'search', userId);
		const hits = await ctx.vectorSearch('embeddingVectors', 'by_embedding', {
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

// Vector search hits back to item ids, in hit order; null for a stale model's
// row. Reads only the small itemEmbeddings rows, not the vectors.
export const itemIdsForHits = internalQuery({
	args: { ids: v.array(v.id('embeddingVectors')) },
	handler: async (ctx, { ids }): Promise<(Id<'items'> | null)[]> => {
		const rows = await Promise.all(
			ids.map((id) =>
				ctx.db
					.query('itemEmbeddings')
					.withIndex('by_vector', (q) => q.eq('vectorId', id))
					.unique()
			)
		);
		return rows.map((row) => (row?.model === EMBEDDING_MODEL ? row.itemId : null));
	}
});
