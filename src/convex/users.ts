import { ConvexError, v } from 'convex/values';
import {
	internalAction,
	internalMutation,
	internalQuery,
	type MutationCtx
} from './_generated/server';
import { internal } from './_generated/api';
import {
	clearLoginAttempts,
	hashPassword,
	hashToken,
	normalizeUsername,
	randomToken,
	requireUser,
	userByUsername,
	userQuery
} from './lib/auth';

// The signed-in user
export const me = userQuery({
	args: {},
	handler: async (ctx) => {
		const user = await ctx.db.get(ctx.userId);
		return { username: user?.username ?? '' };
	}
});

// A public action's caller: its token resolved to the user, or Unauthorized
export const userForToken = internalQuery({
	args: { token: v.string() },
	handler: async (ctx, { token }) => await requireUser(ctx, token)
});

// Admin commands, run from the CLI (add --prod for production)

// Mint a one-time signup link code; it is shown only here.
// Run: npx convex run users:invite
export const invite = internalAction({
	args: {},
	handler: async (ctx): Promise<{ code: string }> => {
		const code = randomToken();
		await ctx.runMutation(internal.users.insertInvite, { codeHash: await hashToken(code) });
		return { code };
	}
});

// Set a password (forgotten, or the owner's first one). Existing sessions stay.
// Run: npx convex run users:setPassword '{"username": "sam", "password": "..."}'
export const setPassword = internalAction({
	args: { username: v.string(), password: v.string() },
	handler: async (ctx, args) => {
		await ctx.runMutation(internal.users.setPasswordHash, {
			username: normalizeUsername(args.username),
			passwordHash: await hashPassword(args.password)
		});
	}
});

// End every session, extension included (e.g. after a leaked password).
// Run: npx convex run users:signOut '{"username": "sam"}'
export const signOut = internalMutation({
	args: { username: v.string() },
	handler: async (ctx, args) => {
		const user = await getUser(ctx, normalizeUsername(args.username));
		const sessions = await ctx.db
			.query('sessions')
			.withIndex('by_user', (q) => q.eq('userId', user._id))
			.collect();
		for (const session of sessions) await ctx.db.delete(session._id);
		return { ended: sessions.length };
	}
});

export const insertInvite = internalMutation({
	args: { codeHash: v.string() },
	handler: async (ctx, args) => {
		await ctx.db.insert('invites', args);
	}
});

export const setPasswordHash = internalMutation({
	args: { username: v.string(), passwordHash: v.string() },
	handler: async (ctx, args) => {
		const user = await getUser(ctx, args.username);
		await ctx.db.patch(user._id, { passwordHash: args.passwordHash });
		await clearLoginAttempts(ctx, user.username);
	}
});

async function getUser(ctx: MutationCtx, username: string) {
	const user = await userByUsername(ctx, username);
	if (!user) throw new ConvexError(`no user named ${username}`);
	return user;
}
