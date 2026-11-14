// Discovery feed (prototype): a curated list of outside sources
// (lib/discoverySources.ts) polled into one shared candidate pool. Each user
// sees it as a mixed feed of the sources they haven't turned off, and keeps
// from it or skips. Keeping is discoveryKeep.ts. Background:
// reference/discovery-research.md.
import { ConvexError, v, type Infer } from 'convex/values';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import {
	internalAction,
	internalMutation,
	internalQuery,
	type ActionCtx,
	type QueryCtx
} from './_generated/server';
import { requireUser, userMutation, userQuery } from './lib/auth';
import {
	SOURCES,
	fetchSource,
	resolveOriginal,
	type FetchedCandidate
} from './lib/discoverySources';
import { normalizeUrl } from './lib/urls';
import { getPreferences } from './viewPreferences';
import schema from './schema';

// Candidates each source contributes to the feed window; a grouped source shares
// its slot, so needs fewer
const PER_SOURCE = 100;
const PER_GROUPED_SOURCE = 40;
const PREFS_KEY = 'discover'; // The viewPreferences row holding hiddenSources

const candidateFields = schema.tables.discoveryCandidates.validator.fields;
const fetchedValidator = v.object({
	externalId: candidateFields.externalId,
	kind: candidateFields.kind,
	url: candidateFields.url,
	title: candidateFields.title,
	description: candidateFields.description,
	author: candidateFields.author,
	tags: candidateFields.tags,
	imageUrl: candidateFields.imageUrl,
	imageWidth: candidateFields.imageWidth,
	imageHeight: candidateFields.imageHeight,
	videoUrl: candidateFields.videoUrl,
	publishedAt: candidateFields.publishedAt
});

// ============ Feed ============

type Dealt = { candidate: FeedCandidate; round: number };
const byRound = (a: Dealt, b: Dealt) =>
	a.round - b.round || b.candidate.publishedAt - a.candidate.publishedAt;

export type FeedCandidate = Doc<'discoveryCandidates'> & { sourceName: string };

// A plain round-robin over the user's sources: each source's newest-first list
// is dealt out one card per source (or source group) per round, newest first
// within a round. A
// card's round counts the cards the user already acted on, so keeping or
// skipping one never reshuffles the rest. Links already in the library are left
// out.
export const feed = userQuery({
	args: { limit: v.number() },
	handler: async (ctx, { limit }) => {
		const prefs = await getPreferences(ctx, PREFS_KEY);
		const hidden = new Set(prefs?.hiddenSources ?? []);
		const polls = new Map(
			(await ctx.db.query('discoverySources').collect()).map((row) => [row.key, row])
		);
		const states = await ctx.db
			.query('discoveryStates')
			.withIndex('by_user_candidate', (q) => q.eq('userId', ctx.userId))
			.collect();
		const acted = new Set<string>(states.map((s) => s.candidateId));

		// Within a group (a set of Are.na channels), its sources are dealt into
		// one list first, so the group takes a single slot per round. Positions
		// count acted-on cards, which are dropped only afterwards.
		const groups = new Map<string, { candidate: FeedCandidate; round: number }[]>();
		for (const source of SOURCES) {
			if (hidden.has(source.key)) continue;
			const candidates = await ctx.db
				.query('discoveryCandidates')
				.withIndex('by_source_published', (q) => q.eq('sourceKey', source.key))
				.order('desc')
				.take(source.group ? PER_GROUPED_SOURCE : PER_SOURCE);
			const group = groups.get(source.group ?? source.key) ?? [];
			candidates.forEach((candidate, round) =>
				group.push({ candidate: { ...candidate, sourceName: source.name }, round })
			);
			groups.set(source.group ?? source.key, group);
		}
		const dealt = [...groups.values()]
			.flatMap((group) => group.sort(byRound).map(({ candidate }, round) => ({ candidate, round })))
			.filter(({ candidate }) => !acted.has(candidate._id))
			.sort(byRound);

		// Checked only as far as the page reaches, one index lookup each
		const shown: FeedCandidate[] = [];
		let next = 0;
		for (; next < dealt.length && shown.length < limit; next++) {
			const { candidate } = dealt[next];
			const saved = await ctx.db
				.query('items')
				.withIndex('by_user_normUrl', (q) =>
					q.eq('userId', ctx.userId).eq('normUrl', candidate.normUrl)
				)
				.first();
			if (!saved) shown.push(candidate);
		}

		return {
			candidates: shown,
			remaining: dealt.length - next,
			sources: SOURCES.map((source) => ({
				key: source.key,
				name: source.name,
				group: source.group ?? null,
				hidden: hidden.has(source.key),
				lastPolledAt: polls.get(source.key)?.lastPolledAt ?? null,
				lastError: polls.get(source.key)?.lastError ?? null
			})),
			kept: states.filter((s) => s.state === 'kept').length,
			skipped: states.filter((s) => s.state === 'skipped').length
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

export const skip = userMutation({
	args: { candidateId: v.id('discoveryCandidates') },
	handler: async (ctx, { candidateId }) => {
		const existing = await getState(ctx, ctx.userId, candidateId);
		if (existing) return;
		await ctx.db.insert('discoveryStates', { userId: ctx.userId, candidateId, state: 'skipped' });
	}
});

export const unskip = userMutation({
	args: { candidateId: v.id('discoveryCandidates') },
	handler: async (ctx, { candidateId }) => {
		const existing = await getState(ctx, ctx.userId, candidateId);
		if (existing?.state === 'skipped') await ctx.db.delete(existing._id);
	}
});

// Forget every skip, so the whole pool shows again
export const resetSkips = userMutation({
	args: {},
	handler: async (ctx) => {
		const states = await ctx.db
			.query('discoveryStates')
			.withIndex('by_user_candidate', (q) => q.eq('userId', ctx.userId))
			.collect();
		for (const state of states) if (state.state === 'skipped') await ctx.db.delete(state._id);
	}
});

async function getState(
	ctx: Pick<QueryCtx, 'db'>,
	userId: Id<'users'>,
	candidateId: Id<'discoveryCandidates'>
) {
	return await ctx.db
		.query('discoveryStates')
		.withIndex('by_user_candidate', (q) => q.eq('userId', userId).eq('candidateId', candidateId))
		.unique();
}

// ============ Keeping (called by discoveryKeep.ts) ============

export const userForToken = internalQuery({
	args: { token: v.string() },
	handler: async (ctx, { token }) => await requireUser(ctx, token)
});

export const getCandidate = internalQuery({
	args: { candidateId: v.id('discoveryCandidates') },
	handler: async (ctx, { candidateId }) => await ctx.db.get(candidateId)
});

export const markKept = internalMutation({
	args: {
		userId: v.id('users'),
		candidateId: v.id('discoveryCandidates'),
		itemId: v.id('items')
	},
	handler: async (ctx, { userId, candidateId, itemId }) => {
		const existing = await getState(ctx, userId, candidateId);
		if (existing) await ctx.db.patch(existing._id, { state: 'kept', itemId });
		else await ctx.db.insert('discoveryStates', { userId, candidateId, state: 'kept', itemId });
	}
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
		let fetched: FetchedCandidate[] = await fetchSource(source);
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

export const ingest = internalMutation({
	args: { sourceKey: v.string(), candidates: v.array(fetchedValidator) },
	handler: async (ctx, { sourceKey, candidates }) => {
		let added = 0;
		for (const candidate of candidates) {
			const normUrl = normalizeUrl(candidate.url);
			const existing = await ctx.db
				.query('discoveryCandidates')
				.withIndex('by_normUrl', (q) => q.eq('normUrl', normUrl))
				.first();
			if (existing) continue;
			await ctx.db.insert('discoveryCandidates', { ...candidate, sourceKey, normUrl });
			added++;
		}
		return added;
	}
});

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

// Dev: forget a source's candidates (and everyone's keep/skip on them), then
// poll it again. Run: npx convex run discovery:resetSource '{"key":"awwwards"}'
export const resetSource = internalMutation({
	args: { key: v.string() },
	handler: async (ctx, { key }) => {
		const candidates = await ctx.db
			.query('discoveryCandidates')
			.withIndex('by_source_published', (q) => q.eq('sourceKey', key))
			.collect();
		const ids = new Set<string>(candidates.map((c) => c._id));
		for (const state of await ctx.db.query('discoveryStates').collect()) {
			if (ids.has(state.candidateId)) await ctx.db.delete(state._id);
		}
		for (const candidate of candidates) await ctx.db.delete(candidate._id);
		await ctx.scheduler.runAfter(0, internal.discovery.pollSource, { key });
		return candidates.length;
	}
});
