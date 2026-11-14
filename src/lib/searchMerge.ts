import type { Id } from '../convex/_generated/dataModel';

// Reciprocal rank fusion's damping constant; the usual 60 keeps either list
// from deciding the order alone
const RRF_K = 60;
export const SIMILAR_LIMIT = 24;

export interface MergedSearch<T> {
	// Keyword matches, best first
	matches: T[];
	// The nearest items that matched no keyword
	similar: T[];
}

// Hybrid search: the keyword matches stay the results, re-ranked by fusing
// their keyword rank with their rank among the query's nearest neighbours
// (embeddings.search); the nearest items without a keyword match follow as
// "similar". Embedding scores can't tell a good query from nonsense, so they
// only reorder and suggest, never filter.
export function mergeSearch<T extends { _id: Id<'items'> }>(
	keywordMatches: T[],
	nearest: Id<'items'>[],
	lookup: (id: Id<'items'>) => T | undefined
): MergedSearch<T> {
	const nearestRank = new Map(nearest.map((id, rank) => [id, rank]));
	const fused = (id: Id<'items'>, keywordRank: number) => {
		const rank = nearestRank.get(id);
		return 1 / (RRF_K + keywordRank) + (rank === undefined ? 0 : 1 / (RRF_K + rank));
	};
	const matches = keywordMatches
		.map((item, rank) => ({ item, score: fused(item._id, rank) }))
		.sort((a, b) => b.score - a.score)
		.map(({ item }) => item);

	const matched = new Set(keywordMatches.map((item) => item._id));
	const similar = nearest
		.filter((id) => !matched.has(id))
		.map(lookup)
		.filter((item) => item !== undefined)
		.slice(0, SIMILAR_LIMIT);

	return { matches, similar };
}
