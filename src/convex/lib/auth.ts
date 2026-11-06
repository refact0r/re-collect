import { ConvexError, v, type ObjectType, type PropertyValidators } from 'convex/values';
import { mutation, query, type MutationCtx, type QueryCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';

// Access codes are long random strings, so a fast unsalted hash is enough
export async function hashCode(code: string) {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code));
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// The one identity seam: resolves the caller's access code (the `token` arg,
// sent by the SvelteKit client and the browser extension) to their user. A
// real auth provider would replace this with `ctx.auth.getUserIdentity()`.
export async function requireUser(ctx: QueryCtx, token: string | undefined) {
	if (!token) throw new ConvexError('Unauthorized');
	const codeHash = await hashCode(token);
	const user = await ctx.db
		.query('users')
		.withIndex('by_codeHash', (q) => q.eq('codeHash', codeHash))
		.unique();
	if (!user) throw new ConvexError('Unauthorized');
	return user._id;
}

export type UserQueryCtx = QueryCtx & { userId: Id<'users'> };
export type UserMutationCtx = MutationCtx & { userId: Id<'users'> };

// Fetch a document only if the current user owns it; anyone else's looks missing
export async function getOwned<T extends 'items' | 'collections'>(
	ctx: UserQueryCtx,
	id: Id<T>
): Promise<Doc<T> | null> {
	const doc = (await ctx.db.get(id)) as Doc<T> | null;
	return doc && doc.userId === ctx.userId ? doc : null;
}

// Public query/mutation for the signed-in user: adds the optional `token` arg,
// resolves it to `ctx.userId`, and strips it before the handler runs.
export function userQuery<Args extends PropertyValidators, Output>(def: {
	args: Args;
	handler: (ctx: UserQueryCtx, args: ObjectType<Args>) => Output;
}) {
	return query({
		args: { ...def.args, token: v.optional(v.string()) },
		handler: async (ctx, allArgs) => {
			const { token, ...args } = allArgs as ObjectType<Args> & { token?: string };
			const userId = await requireUser(ctx, token);
			return def.handler({ ...ctx, userId }, args as ObjectType<Args>);
		}
	});
}

export function userMutation<Args extends PropertyValidators, Output>(def: {
	args: Args;
	handler: (ctx: UserMutationCtx, args: ObjectType<Args>) => Output;
}) {
	return mutation({
		args: { ...def.args, token: v.optional(v.string()) },
		handler: async (ctx, allArgs) => {
			const { token, ...args } = allArgs as ObjectType<Args> & { token?: string };
			const userId = await requireUser(ctx, token);
			return def.handler({ ...ctx, userId }, args as ObjectType<Args>);
		}
	});
}
