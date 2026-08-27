import { ConvexError, v, type ObjectType, type PropertyValidators } from 'convex/values';
import { mutation, type MutationCtx } from '../_generated/server';

export function requireAuth(token: string | undefined) {
	const expected = process.env.CONVEX_WRITE_TOKEN;
	if (!expected || token !== expected) {
		throw new ConvexError('Unauthorized');
	}
}

// Public mutation gated by the write token: adds the optional `token` arg,
// checks it, and strips it before the handler runs.
export function authedMutation<Args extends PropertyValidators, Output>(def: {
	args: Args;
	handler: (ctx: MutationCtx, args: ObjectType<Args>) => Output;
}) {
	return mutation({
		args: { ...def.args, token: v.optional(v.string()) },
		handler: (ctx, allArgs) => {
			const { token, ...args } = allArgs as ObjectType<Args> & { token?: string };
			requireAuth(token);
			return def.handler(ctx, args as ObjectType<Args>);
		}
	});
}
