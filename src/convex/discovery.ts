// Discovery feed (prototype): a curated list of outside sources
// (lib/discoverySources.ts) polled into one shared candidate pool. Each user
// sees it as a mixed feed of the sources they haven't turned off, and keeps
// what catches their eye (discoveryKeep.ts). Background:
// reference/discovery-research.md.
import { ConvexError, v, type Infer } from 'convex/values';
import { internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import {
	internalAction,
	internalMutation,
	internalQuery,
	type ActionCtx,
	type QueryCtx
} from './_generated/server';
import { userMutation, userQuery } from './lib/auth';
import {
	SOURCES,
	fetchSource,
	resolveOriginal,
	type FetchedCandidate,
	type SourceConfig
} from './lib/discoverySources';
import { isWebUrl, normalizeUrl } from './lib/urls';
import { getPreferences } from './viewPreferences';
import schema from './schema';

// Candidates each source contributes to the feed window; a grouped source shares
// its slot, so needs fewer
const PER_SOURCE = 100;
const PER_GROUPED_SOURCE = 40;
// Library lookups run in parallel batches of at most this many
const LOOKUP_BATCH = 100;
const PREFS_KEY = 'discover'; // The viewPreferences row holding hiddenSources
// A poll looks at no more than a source's newest this many entries (Seesaw's
// page; an RSS feed is otherwise as long as its site makes it), so expiry
// knows how far back a poll can reach
const POLL_LIMIT = 120;
// Expiry: a candidate stored over a month ago goes, unless it's among its
// source's newest KEEP_PER_SOURCE. That window holds everything a poll can
// return, with room for sources that don't list strictly newest first, so a
// slow source still returning months-old entries never sees one as new again;
// and it holds the whole feed window (PER_SOURCE), so expiry never changes the feed
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const KEEP_PER_SOURCE = 300;
const EXPIRE_BATCH = 500;

const fetchedValidator = schema.tables.discoveryCandidates.validator.omit(
	'sourceKey',
	'normUrl',
	'author',
	'tags'
);

// ============ Feed ============

type Dealt = { candidate: Doc<'discoveryCandidates'>; source: SourceConfig; round: number };
const byRound = (a: Dealt, b: Dealt) =>
	a.round - b.round || b.candidate.publishedAt - a.candidate.publishedAt;

// Only what the cards show. `from` is their short label: the site, not the
// Are.na channel
const toCard = ({ candidate: c, source }: Dealt) => ({
	_id: c._id,
	url: c.url,
	title: c.title,
	imageUrl: c.imageUrl,
	imageWidth: c.imageWidth,
	imageHeight: c.imageHeight,
	videoUrl: c.videoUrl,
	sourceName: source.name,
	from: source.kind === 'arena' ? 'Are.na' : source.name
});
export type FeedCandidate = ReturnType<typeof toCard>;

// A plain round-robin over the user's sources: each source's newest-first list
// is dealt out one card per source (or source group) per round, newest first
// within a round. A link several sources carry shows once, as its first card,
// and links already in the library (kept ones included) are left out; both
// only after dealing, so keeping a card never reshuffles the rest.
export const feed = userQuery({
	args: { limit: v.number() },
	handler: async (ctx, { limit }) => {
		const prefs = await getPreferences(ctx, PREFS_KEY);
		const hidden = new Set(prefs?.hiddenSources ?? []);
		const sources = SOURCES.filter((source) => !hidden.has(source.key));
		const lists = await Promise.all(
			sources.map((source) =>
				ctx.db
					.query('discoveryCandidates')
					.withIndex('by_source_published', (q) => q.eq('sourceKey', source.key))
					.order('desc')
					.take(source.group ? PER_GROUPED_SOURCE : PER_SOURCE)
			)
		);

		// Within a group (a set of Are.na channels), its sources are dealt into
		// one list first, so the group takes a single slot per round
		const groups = new Map<string, Dealt[]>();
		sources.forEach((source, i) => {
			const group = groups.get(source.group ?? source.key) ?? [];
			lists[i].forEach((candidate, round) => group.push({ candidate, source, round }));
			groups.set(source.group ?? source.key, group);
		});
		const dealt = [...groups.values()]
			.flatMap((group) => group.sort(byRound).map((card, round) => ({ ...card, round })))
			.sort(byRound);

		// Checked only as far as the page reaches. Each batch holds no more cards
		// than the page still needs, so none past its end is looked up
		const shown: FeedCandidate[] = [];
		const seen = new Set<string>();
		let next = 0;
		while (next < dealt.length && shown.length < limit) {
			const batch = dealt.slice(next, next + Math.min(limit - shown.length, LOOKUP_BATCH));
			next += batch.length;
			const firsts = batch.filter(({ candidate }) => {
				if (seen.has(candidate.normUrl)) return false;
				seen.add(candidate.normUrl);
				return true;
			});
			const saved = await Promise.all(
				firsts.map(({ candidate }) =>
					ctx.db
						.query('items')
						.withIndex('by_user_normUrl', (q) =>
							q.eq('userId', ctx.userId).eq('normUrl', candidate.normUrl)
						)
						.first()
				)
			);
			shown.push(...firsts.filter((_, i) => !saved[i]).map(toCard));
		}

		return {
			candidates: shown,
			remaining: dealt.length - next,
			sources: SOURCES.map((source) => ({
				key: source.key,
				name: source.name,
				group: source.group ?? null,
				hidden: hidden.has(source.key)
			}))
		};
	}
});

// Turns a source on or off in this user's feed
export const setSourceHidden = userMutation({
	args: { key: v.string(), hidden: v.boolean() },
	handler: async (ctx, { key, hidden }) => {
		if (!SOURCES.some((s) => s.key === key)) throw new ConvexError('unknown source');
		const prefs = await getPreferences(ctx, PREFS_KEY);
		const others = (prefs?.hiddenSources ?? []).filter((k) => k !== key);
		const hiddenSources = hidden ? [...others, key] : others;
		if (prefs) await ctx.db.patch(prefs._id, { hiddenSources });
		else
			await ctx.db.insert('viewPreferences', { userId: ctx.userId, key: PREFS_KEY, hiddenSources });
	}
});

// ============ Keeping (called by discoveryKeep.ts) ============

export const getCandidate = internalQuery({
	args: { candidateId: v.id('discoveryCandidates') },
	handler: async (ctx, { candidateId }) => await ctx.db.get(candidateId)
});

// ============ Polling (cron, crons.ts) ============

export const pollAll = internalAction({
	args: {},
	handler: async (ctx) => {
		// Are.na channels go one at a time: they share one rate limit
		const arenaKeys = SOURCES.filter((s) => s.kind === 'arena').map((s) => s.key);
		const otherKeys = SOURCES.filter((s) => s.kind !== 'arena').map((s) => s.key);
		const added: Record<string, number> = {};
		await Promise.all([
			...otherKeys.map(async (key) => (added[key] = await pollOne(ctx, key))),
			(async () => {
				for (const key of arenaKeys) added[key] = await pollOne(ctx, key);
			})()
		]);
		console.log('discovery poll:', added);
	}
});

export const pollSource = internalAction({
	args: { key: v.string() },
	handler: async (ctx, { key }) => {
		console.log(`discovery poll ${key}:`, await pollOne(ctx, key));
	}
});

async function pollOne(ctx: ActionCtx, key: string): Promise<number> {
	const source = SOURCES.find((s) => s.key === key);
	if (!source) throw new Error(`unknown discovery source ${key}`);
	try {
		let fetched: FetchedCandidate[] = (await fetchSource(source))
			.sort((a, b) => b.publishedAt - a.publishedAt)
			.slice(0, POLL_LIMIT);
		// Only unseen entries cost a detail-page fetch to find the original site
		const fresh = new Set(
			await ctx.runQuery(internal.discovery.unseen, {
				sourceKey: key,
				externalIds: fetched.map((c) => c.externalId)
			})
		);
		fetched = fetched.filter((c) => fresh.has(c.externalId));
		// One at a time: a burst of detail-page fetches gets refused
		if (source.kind === 'rss') {
			for (const candidate of fetched) {
				candidate.url = (await resolveOriginal(key, candidate.url)) ?? candidate.url;
			}
		}
		let added = 0;
		for (let i = 0; i < fetched.length; i += 50) {
			added += await ctx.runMutation(internal.discovery.ingest, {
				sourceKey: key,
				candidates: fetched.slice(i, i + 50).map(toValidated)
			});
		}
		await ctx.runMutation(internal.discovery.recordPoll, { key });
		return added;
	} catch (error) {
		console.error(`discovery poll ${key}:`, error);
		await ctx.runMutation(internal.discovery.recordPoll, { key, error: String(error) });
		return 0;
	}
}

// Drops null, undefined and empty fields the validator would refuse or store
function toValidated(c: FetchedCandidate): Infer<typeof fetchedValidator> {
	return Object.fromEntries(
		Object.entries(c).filter(
			([, value]) => value != null && value !== '' && !(Array.isArray(value) && !value.length)
		)
	) as Infer<typeof fetchedValidator>;
}

// The entries a source hasn't delivered before, by its own ids
export const unseen = internalQuery({
	args: { sourceKey: v.string(), externalIds: v.array(v.string()) },
	handler: async (ctx, { sourceKey, externalIds }) => {
		const found = await Promise.all(
			externalIds.map((externalId) =>
				ctx.db
					.query('discoveryCandidates')
					.withIndex('by_source_externalId', (q) =>
						q.eq('sourceKey', sourceKey).eq('externalId', externalId)
					)
					.first()
			)
		);
		return externalIds.filter((_, i) => !found[i]);
	}
});

// Stored once per source entry; a link other sources also carry is stored under
// each (the feed shows it once), so hiding one source never hides it from another.
// Links reach an href, so anything but http(s) is dropped
export const ingest = internalMutation({
	args: { sourceKey: v.string(), candidates: v.array(fetchedValidator) },
	handler: async (ctx, { sourceKey, candidates }) => {
		let added = 0;
		for (const { videoUrl, ...candidate } of candidates) {
			if (!isWebUrl(candidate.url) || !isWebUrl(candidate.imageUrl)) continue;
			const existing = await ctx.db
				.query('discoveryCandidates')
				.withIndex('by_source_externalId', (q) =>
					q.eq('sourceKey', sourceKey).eq('externalId', candidate.externalId)
				)
				.first();
			if (existing) continue;
			await ctx.db.insert('discoveryCandidates', {
				...candidate,
				...(videoUrl && isWebUrl(videoUrl) ? { videoUrl } : {}),
				sourceKey,
				normUrl: normalizeUrl(candidate.url)
			});
			added++;
		}
		return added;
	}
});

// Poll state, written for a look in the dashboard; nothing reads it
export const recordPoll = internalMutation({
	args: { key: v.string(), error: v.optional(v.string()) },
	handler: async (ctx, { key, error }) => {
		const row = await ctx.db
			.query('discoverySources')
			.withIndex('by_key', (q) => q.eq('key', key))
			.unique();
		const poll = { lastPolledAt: Date.now(), lastError: error };
		if (row) await ctx.db.patch(row._id, poll);
		else await ctx.db.insert('discoverySources', { key, ...poll });
	}
});

// ============ Expiry (cron, crons.ts) ============

// Deletes the candidates past their source's newest KEEP_PER_SOURCE that were
// stored over MAX_AGE_MS ago, and every candidate of a source no longer in
// SOURCES (nothing polls or shows those). One page of one source per run, newest
// first; the rest is scheduled, with `passed` counting the rows paged through.
export const expireCandidates = internalMutation({
	args: {
		sourceKey: v.optional(v.string()),
		passed: v.optional(v.number()),
		cursor: v.optional(v.string())
	},
	handler: async (ctx, { sourceKey, passed = 0, cursor }) => {
		const key = sourceKey ?? (await sourceAfter(ctx));
		if (key === null) return;
		const removed = !SOURCES.some((source) => source.key === key);
		const cutoff = Date.now() - MAX_AGE_MS;
		const { page, isDone, continueCursor } = await ctx.db
			.query('discoveryCandidates')
			.withIndex('by_source_published', (q) => q.eq('sourceKey', key))
			.order('desc')
			.paginate({ numItems: EXPIRE_BATCH, cursor: cursor ?? null });
		for (const [i, candidate] of page.entries()) {
			const expired = passed + i >= KEEP_PER_SOURCE && candidate._creationTime < cutoff;
			if (removed || expired) await ctx.db.delete(candidate._id);
		}
		const next = isDone
			? { sourceKey: (await sourceAfter(ctx, key)) ?? undefined }
			: { sourceKey: key, passed: passed + page.length, cursor: continueCursor };
		if (next.sourceKey) await ctx.scheduler.runAfter(0, internal.discovery.expireCandidates, next);
	}
});

// The next source key with candidates after `after` (or the first), one index read
async function sourceAfter(ctx: QueryCtx, after?: string) {
	const candidate = await ctx.db
		.query('discoveryCandidates')
		.withIndex('by_source_published', (q) => (after === undefined ? q : q.gt('sourceKey', after)))
		.first();
	return candidate?.sourceKey ?? null;
}

// Migration: clears the author and tags candidates are no longer stored with,
// so the schema can drop them. Run: npx convex run discovery:dropAuthorAndTags
export const dropAuthorAndTags = internalMutation({
	args: { cursor: v.optional(v.string()) },
	handler: async (ctx, { cursor }) => {
		const { page, isDone, continueCursor } = await ctx.db
			.query('discoveryCandidates')
			.paginate({ numItems: 200, cursor: cursor ?? null });
		for (const candidate of page) {
			if (candidate.author !== undefined || candidate.tags !== undefined) {
				await ctx.db.patch(candidate._id, { author: undefined, tags: undefined });
			}
		}
		if (!isDone) {
			await ctx.scheduler.runAfter(0, internal.discovery.dropAuthorAndTags, {
				cursor: continueCursor
			});
		}
	}
});

// Dev: forget a source's candidates, then
// poll it again. Run: npx convex run discovery:resetSource '{"key":"awwwards"}'
export const resetSource = internalMutation({
	args: { key: v.string() },
	handler: async (ctx, { key }) => {
		const candidates = await ctx.db
			.query('discoveryCandidates')
			.withIndex('by_source_published', (q) => q.eq('sourceKey', key))
			.collect();
		for (const candidate of candidates) await ctx.db.delete(candidate._id);
		await ctx.scheduler.runAfter(0, internal.discovery.pollSource, { key });
		return candidates.length;
	}
});
