import { ConvexError, v, type ObjectType, type PropertyValidators } from 'convex/values';
import type { Auth } from 'convex/server';
import { mutation, query, type MutationCtx, type QueryCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';

// tokenIdentifier of the owner user, which the shared write token resolves to
export const OWNER_TOKEN_IDENTIFIER = 'owner';

// The one identity seam: returns the caller's tokenIdentifier (usable from
// actions too). Today the shared CONVEX_WRITE_TOKEN (held by the SvelteKit
// server and the browser extension) maps to the owner. With a real auth
// provider this becomes `(await ctx.auth.getUserIdentity())?.tokenIdentifier`
// and the `token` arg on the wrappers below goes away.
export async function requireIdentity(ctx: { auth: Auth }, token: string | undefined) {
	const expected = process.env.CONVEX_WRITE_TOKEN;
	if (!expected || token !== expected) throw new ConvexError('Unauthorized');
	return OWNER_TOKEN_IDENTIFIER;
}

export async function requireUser(ctx: QueryCtx, token: string | undefined) {
	const tokenIdentifier = await requireIdentity(ctx, token);
	const user = await ctx.db
		.query('users')
		.withIndex('by_tokenIdentifier', (q) => q.eq('tokenIdentifier', tokenIdentifier))
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
