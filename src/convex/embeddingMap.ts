import { v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';
import { userQuery } from './lib/auth';
import { EMBEDDING_MODEL } from './lib/embedder';

// The database side of the library map; the layout run is
// embeddingMapActions.refresh (Node, for memory headroom).

const pointValidator = v.object({ itemId: v.id('items'), x: v.number(), y: v.number() });

// The caller's map, or null before the first layout (or after a model change)
export const get = userQuery({
	args: {},
	handler: async (ctx) => {
		const map = await ctx.db
			.query('embeddingMaps')
			.withIndex('by_user', (q) => q.eq('userId', ctx.userId))
			.unique();
		if (!map || map.model !== EMBEDDING_MODEL) return null;
		return { points: map.points, computedAt: map.computedAt };
	}
});

export const getForLayout = internalQuery({
	args: { userId: v.id('users') },
	handler: async (ctx, { userId }) =>
		await ctx.db
			.query('embeddingMaps')
			.withIndex('by_user', (q) => q.eq('userId', userId))
			.unique()
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
			.map(({ itemId, inputKey, embedding }) => ({ itemId, inputKey, embedding }));
		return { rows, isDone, continueCursor };
	}
});

export const save = internalMutation({
	args: {
		userId: v.id('users'),
		model: v.string(),
		signature: v.string(),
		points: v.array(pointValidator)
	},
	handler: async (ctx, { userId, ...fields }) => {
		const existing = await ctx.db
			.query('embeddingMaps')
			.withIndex('by_user', (q) => q.eq('userId', userId))
			.unique();
		const map = { ...fields, computedAt: Date.now() };
		if (existing) await ctx.db.patch(existing._id, map);
		else await ctx.db.insert('embeddingMaps', { userId, ...map });
	}
});
