import { v } from 'convex/values';
import type { Id } from './_generated/dataModel';
import {
	internalMutation,
	internalQuery,
	type MutationCtx,
	type QueryCtx
} from './_generated/server';
import { userQuery } from './lib/auth';
import { EMBEDDING_MODEL, isImageKey } from './lib/embedder';

// The database side of the library map; the layout run is
// embeddingMapActions.refresh (Node, for memory headroom).

const pointValidator = v.object({ itemId: v.id('items'), x: v.number(), y: v.number() });

const findState = (ctx: QueryCtx, userId: Id<'users'>) =>
	ctx.db
		.query('embeddingMapStates')
		.withIndex('by_user', (q) => q.eq('userId', userId))
		.unique();

const findLayout = (ctx: QueryCtx, userId: Id<'users'>) =>
	ctx.db
		.query('embeddingMapLayouts')
		.withIndex('by_user', (q) => q.eq('userId', userId))
		.unique();

// Called by every write to a user's image embeddings, so refresh knows its
// layout is out of date without reading every vector
export async function markMapStale(ctx: MutationCtx, userId: Id<'users'>) {
	const state = await findState(ctx, userId);
	if (state) await ctx.db.patch(state._id, { version: state.version + 1 });
	else {
		await ctx.db.insert('embeddingMapStates', { userId, model: '', version: 1, layoutVersion: 0 });
	}
}

// The caller's map points, or null before the first layout (or after a model
// change). Reads only the layout, so an embedding write doesn't re-run it.
export const get = userQuery({
	args: {},
	handler: async (ctx) => {
		const layout = await findLayout(ctx, ctx.userId);
		return layout?.model === EMBEDDING_MODEL ? { points: layout.points } : null;
	}
});

export const getState = internalQuery({
	args: { userId: v.id('users') },
	handler: (ctx, { userId }) => findState(ctx, userId)
});

// The stored layout's points, whatever its model, for a new layout to align to
export const previousPoints = internalQuery({
	args: { userId: v.id('users') },
	handler: async (ctx, { userId }) => (await findLayout(ctx, userId))?.points ?? []
});

// Up to one ~6 KB vector a row, so a page stays far under a query's read limits
const VECTOR_PAGE_SIZE = 256;

// A page of the user's current-model image vectors: the map shows how things
// look, so items read as words (notes, content links, failed captures) stay off
// it, and their vectors aren't read. Rows from another model are stale.
export const vectorPage = internalQuery({
	args: { userId: v.id('users'), cursor: v.union(v.string(), v.null()) },
	handler: async (ctx, { userId, cursor }) => {
		const { page, isDone, continueCursor } = await ctx.db
			.query('itemEmbeddings')
			.withIndex('by_user', (q) => q.eq('userId', userId))
			.paginate({ numItems: VECTOR_PAGE_SIZE, cursor });
		const shown = page.filter((row) => row.model === EMBEDDING_MODEL && isImageKey(row.inputKey));
		const vectors = await Promise.all(
			shown.map(async (row) => (await ctx.db.get(row.vectorId))?.embedding)
		);
		const rows = shown.flatMap((row, i) => {
			const embedding = vectors[i];
			return embedding ? [{ itemId: row.itemId, embedding }] : [];
		});
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
	handler: async (ctx, { userId, model, points, layoutVersion }) => {
		// The account was deleted while the layout ran
		if (!(await ctx.db.get(userId))) return;
		const state = await findState(ctx, userId);
		// A slower run that started earlier mustn't overwrite a newer layout
		if (state?.model === model && state.layoutVersion > layoutVersion) return;
		if (state) await ctx.db.patch(state._id, { model, layoutVersion });
		else {
			const version = layoutVersion;
			await ctx.db.insert('embeddingMapStates', { userId, model, version, layoutVersion });
		}

		const layout = await findLayout(ctx, userId);
		if (layout) await ctx.db.patch(layout._id, { model, points });
		else await ctx.db.insert('embeddingMapLayouts', { userId, model, points });
	}
});
