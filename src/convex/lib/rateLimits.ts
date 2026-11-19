import { DAY, HOUR, MINUTE, RateLimiter, SECOND } from '@convex-dev/rate-limiter';
import { ConvexError } from 'convex/values';
import { components } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import type { ActionCtx, MutationCtx, QueryCtx } from '../_generated/server';

// Waitlist joins across everyone: room for a crowd signing up at once, while a
// script takes over an hour to fill the list
export const JOIN_BURST = 60;

// Per user: a token bucket refills at `rate` a `period` and holds up to
// `capacity`, so a busy session can spend that many at once
export const USER_LIMITS = {
	// A new item (items.add) or a new capture of one (screenshots.reimageItem)
	save: { kind: 'token bucket', rate: 200, period: DAY, capacity: 50 },
	// tagging.retagItem, which runs a tagging model again
	retag: { kind: 'token bucket', rate: 300, period: DAY, capacity: 50 },
	// An image stored in R2: the app's own PUT (r2.generateUploadUrl) or one the
	// server fetches and stores (the imageImport saves, discoveryKeep.keep)
	upload: { kind: 'token bucket', rate: 200, period: DAY, capacity: 50 },
	// embeddings.search: a Workers AI call and a vector search
	search: { kind: 'token bucket', rate: 60, period: MINUTE, capacity: 20 }
} as const;

type UserLimit = keyof typeof USER_LIMITS;

export const rateLimiter = new RateLimiter(components.rateLimiter, {
	join: { kind: 'token bucket', rate: 30, period: MINUTE, capacity: JOIN_BURST },
	...USER_LIMITS
});

const REFUSALS: Record<UserLimit, string> = {
	save: 'you’ve saved a lot today',
	retag: 'you’ve re-tagged a lot today',
	upload: 'you’ve uploaded a lot of images today',
	search: 'lots of searches at once'
};

function whenToRetry(ms: number) {
	if (ms < 45 * SECOND) return 'in a few seconds';
	const minutes = Math.round(ms / MINUTE);
	if (minutes <= 1) return 'in a minute';
	if (minutes < 60) return `in about ${minutes} minutes`;
	const hours = Math.round(ms / HOUR);
	return hours === 1 ? 'in about an hour' : `in about ${hours} hours`;
}

function refuse(name: UserLimit, retryAfter: number) {
	return new ConvexError(`${REFUSALS[name]}, try again ${whenToRetry(retryAfter)}`);
}

// Spends one of the user's `name` allowance, or refuses the call. Call it before
// any other work, so a refused call costs nothing; in a mutation a later throw
// gives the token back.
export async function limitUser(
	ctx: MutationCtx | ActionCtx,
	name: UserLimit,
	userId: Id<'users'>
) {
	const { ok, retryAfter } = await rateLimiter.limit(ctx, name, { key: userId });
	if (!ok) throw refuse(name, retryAfter);
}

// Refuses the call if `name` has nothing left, without spending any: for work
// that leads to a call limitUser counts later
export async function checkUser(
	ctx: QueryCtx | MutationCtx | ActionCtx,
	name: UserLimit,
	userId: Id<'users'>
) {
	const { ok, retryAfter } = await rateLimiter.check(ctx, name, { key: userId });
	if (!ok) throw refuse(name, retryAfter);
}

// An image stored for a new item: counted as an upload, and refused up front
// when the item it's for couldn't be saved either (items.add counts the save)
export async function limitImageUpload(ctx: MutationCtx | ActionCtx, userId: Id<'users'>) {
	await checkUser(ctx, 'save', userId);
	await limitUser(ctx, 'upload', userId);
}
