'use node';

import { ConvexError, v } from 'convex/values';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { action } from './_generated/server';
import { EMBEDDING_MODEL } from './lib/embedder';
import { layoutMap } from './lib/embeddingMap';

// Node rather than the default runtime for its 512 MB: the run holds every
// vector (6 KB each) plus UMAP's neighbour graph, which outgrows the default
// runtime's 64 MB at a few thousand items.

const MAX_POINTS = 8192; // the stored points array's element limit

// Lays the caller's library map out again if its items or their embeddings
// changed since the stored one; otherwise does nothing. Returns whether it did.
export const refresh = action({
	args: { token: v.string() },
	handler: async (ctx, { token }): Promise<boolean> => {
		const userId = await ctx.runQuery(internal.users.userForToken, { token });
		const previous = await ctx.runQuery(internal.embeddingMap.getForLayout, { userId });
		if (previous?.model === EMBEDDING_MODEL && previous.version === previous.layoutVersion) {
			return false;
		}

		const rows: { itemId: Id<'items'>; embedding: number[] }[] = [];
		let cursor: string | null = null;
		for (;;) {
			const page: {
				rows: typeof rows;
				isDone: boolean;
				continueCursor: string;
			} = await ctx.runQuery(internal.embeddingMap.vectorPage, { userId, cursor });
			rows.push(...page.rows);
			if (page.isDone) break;
			cursor = page.continueCursor;
		}
		if (rows.length > MAX_POINTS) throw new ConvexError('library too big to map');

		// Aligned to the previous layout even across a model change, so the map
		// keeps its orientation
		const points = layoutMap(
			rows.map((row) => row.itemId),
			rows.map((row) => row.embedding),
			previous?.points
		);
		await ctx.runMutation(internal.embeddingMap.save, {
			userId,
			model: EMBEDDING_MODEL,
			points,
			layoutVersion: previous?.version ?? 0
		});
		return true;
	}
});
