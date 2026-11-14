import { ConvexError, v, type ObjectType, type PropertyValidators } from 'convex/values';
import { mutation, query, type MutationCtx, type QueryCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';

const toHex = (bytes: Uint8Array) =>
	[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex: string) => new Uint8Array(hex.match(/../g)!.map((h) => parseInt(h, 16)));

// Session tokens and invite codes are long random strings, so a fast hash is enough
export async function hashToken(token: string) {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
	return toHex(new Uint8Array(digest));
}

// Only call from actions: queries and mutations use seeded randomness
export function randomToken() {
	return toHex(crypto.getRandomValues(new Uint8Array(16)));
}

export function normalizeUsername(username: string) {
	return username.trim().toLowerCase();
}

const PBKDF2_ITERATIONS = 600_000;

async function pbkdf2(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
	const key = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(password),
		'PBKDF2',
		false,
		['deriveBits']
	);
	const bits = await crypto.subtle.deriveBits(
		{ name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
		key,
		256
	);
	return toHex(new Uint8Array(bits));
}

// Stored as `pbkdf2$<iterations>$<salt hex>$<hash hex>`. Slow (~75ms), so
// call from actions.
export async function hashPassword(password: string) {
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
	return ['pbkdf2', PBKDF2_ITERATIONS, toHex(salt), hash].join('$');
}

// Verified against for unknown usernames, so they take as long as real ones
export const DUMMY_PASSWORD_HASH = [
	'pbkdf2',
	PBKDF2_ITERATIONS,
	'0'.repeat(32),
	'0'.repeat(64)
].join('$');

export async function verifyPassword(password: string, stored: string) {
	const [scheme, iterations, salt, hash] = stored.split('$');
	if (scheme !== 'pbkdf2' || !salt || !hash) return false;
	return (await pbkdf2(password, fromHex(salt), Number(iterations))) === hash;
}

// The one identity seam: resolves the caller's session token (the `token` arg,
// sent by the SvelteKit client and the browser extension) to their user. A
// real auth provider would replace this with `ctx.auth.getUserIdentity()`.
export async function requireUser(ctx: QueryCtx, token: string) {
	const tokenHash = await hashToken(token);
	const session = await ctx.db
		.query('sessions')
		.withIndex('by_tokenHash', (q) => q.eq('tokenHash', tokenHash))
		.unique();
	if (!session) throw new ConvexError('Unauthorized');
	return session.userId;
}

export type UserQueryCtx = QueryCtx & { userId: Id<'users'> };
type UserMutationCtx = MutationCtx & { userId: Id<'users'> };

// Fetch a document only if the current user owns it; anyone else's looks missing
export async function getOwned<T extends 'items' | 'collections'>(
	ctx: UserQueryCtx,
	id: Id<T>
): Promise<Doc<T> | null> {
	const doc = (await ctx.db.get(id)) as Doc<T> | null;
	return doc && doc.userId === ctx.userId ? doc : null;
}

// Public query/mutation for the signed-in user: adds the required `token` arg,
// resolves it to `ctx.userId`, and strips it before the handler runs.
export function userQuery<Args extends PropertyValidators, Output>(def: {
	args: Args;
	handler: (ctx: UserQueryCtx, args: ObjectType<Args>) => Output;
}) {
	return query({
		args: { ...def.args, token: v.string() },
		handler: async (ctx, allArgs) => {
			const { token, ...args } = allArgs as ObjectType<Args> & { token: string };
			const userId = await requireUser(ctx, token);
			return def.handler({ ...ctx, userId }, args as unknown as ObjectType<Args>);
		}
	});
}

export function userMutation<Args extends PropertyValidators, Output>(def: {
	args: Args;
	handler: (ctx: UserMutationCtx, args: ObjectType<Args>) => Output;
}) {
	return mutation({
		args: { ...def.args, token: v.string() },
		handler: async (ctx, allArgs) => {
			const { token, ...args } = allArgs as ObjectType<Args> & { token: string };
			const userId = await requireUser(ctx, token);
			return def.handler({ ...ctx, userId }, args as unknown as ObjectType<Args>);
		}
	});
}
