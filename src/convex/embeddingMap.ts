import { v } from 'convex/values';
import type { Id } from './_generated/dataModel';
import {
	internalMutation,
	internalQuery,
	type MutationCtx,
	type QueryCtx
} from './_generated/server';
import { userQuery } from './lib/auth';
import { EMBEDDING_MODEL } from './lib/embedder';

// The database side of the library map; the layout run is
// embeddingMapActions.refresh (Node, for memory headroom).

const pointValidator = v.object({ itemId: v.id('items'), x: v.number(), y: v.number() });

const findMap = (ctx: QueryCtx, userId: Id<'users'>) =>
	ctx.db
		.query('embeddingMaps')
		.withIndex('by_user', (q) => q.eq('userId', userId))
		.unique();

// Called by every write to a user's embeddings, so refresh knows its layout is
// out of date without reading every vector
export async function markMapStale(ctx: MutationCtx, userId: Id<'users'>) {
	const map = await findMap(ctx, userId);
	if (map) await ctx.db.patch(map._id, { version: map.version + 1 });
	else {
		await ctx.db.insert('embeddingMaps', {
			userId,
			model: '',
			points: [],
			computedAt: 0,
			version: 1,
			layoutVersion: 0
		});
	}
}

// The caller's map, or null before the first layout (or after a model change)
export const get = userQuery({
	args: {},
	handler: async (ctx) => {
		const map = await findMap(ctx, ctx.userId);
		if (!map || map.model !== EMBEDDING_MODEL) return null;
		return { points: map.points, computedAt: map.computedAt };
	}
});

export const getForLayout = internalQuery({
	args: { userId: v.id('users') },
	handler: (ctx, { userId }) => findMap(ctx, userId)
});

// ~6 KB a vector, so a page stays far under a query's read limits
const VECTOR_PAGE_SIZE = 256;

// A page of the user's current-model vectors; rows from another model are stale
export const vectorPage = internalQuery({
	args: { userId: v.id('users'), cursor: v.union(v.string(), v.null()) },
	handler: async (ctx, { userId, cursor }) => {
		const { page, isDone, continueCursor } = await ctx.db
			.query('itemEmbeddings')
			.withIndex('by_user', (q) => q.eq('userId', userId))
			.paginate({ numItems: VECTOR_PAGE_SIZE, cursor });
		const rows = page
			.filter((row) => row.model === EMBEDDING_MODEL)
			.map(({ itemId, embedding }) => ({ itemId, embedding }));
		return { rows, isDone, continueCursor };
	}
});

// `layoutVersion` is the version refresh read before its vectors, so a change
// made while it ran leaves the map stale
export const save = internalMutation({
	args: {
		userId: v.id('users'),
		model: v.string(),
		points: v.array(pointValidator),
		layoutVersion: v.number()
	},
	handler: async (ctx, { userId, ...fields }) => {
		const existing = await findMap(ctx, userId);
		const map = { ...fields, computedAt: Date.now() };
		if (existing) await ctx.db.patch(existing._id, map);
		else await ctx.db.insert('embeddingMaps', { userId, ...map, version: fields.layoutVersion });
	}
});
