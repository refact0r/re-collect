import { ConvexError, v } from 'convex/values';
import {
	action,
	internalMutation,
	internalQuery,
	mutation,
	type ActionCtx
} from './_generated/server';
import { internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import {
	DUMMY_PASSWORD_HASH,
	hashPassword,
	hashToken,
	normalizeUsername,
	randomToken,
	requireUser,
	verifyPassword
} from './lib/auth';

// After this many attempts without a success, each further one waits out the lockout
const MAX_FAILED_LOGINS = 10;
const LOCKOUT_MS = 15 * 60 * 1000;

const WRONG_LOGIN = 'wrong username or password';
const INVALID_INVITE = 'this invite link is invalid or already used';

function checkNewPassword(password: string) {
	if (password.length < 8) throw new ConvexError('passwords need 8+ characters');
}

// Throws unless `password` is the user's. The attempt is counted toward the
// lockout before the slow hash runs, so parallel guesses can't all slip in
// under the limit; a successful login or password change clears the count.
async function checkPassword(
	ctx: ActionCtx,
	user: Doc<'users'>,
	password: string,
	wrongMessage: string
) {
	await ctx.runMutation(internal.sessions.countAttempt, { userId: user._id });
	if (!(await verifyPassword(password, user.passwordHash))) {
		throw new ConvexError(wrongMessage);
	}
}

// Each returns a new session token for the SvelteKit server to keep in a cookie
export const login = action({
	args: { username: v.string(), password: v.string() },
	handler: async (ctx, args): Promise<string> => {
		const user = await ctx.runQuery(internal.sessions.getUserByUsername, {
			username: normalizeUsername(args.username)
		});
		if (!user) {
			await verifyPassword(args.password, DUMMY_PASSWORD_HASH);
			throw new ConvexError(WRONG_LOGIN);
		}
		await checkPassword(ctx, user, args.password, WRONG_LOGIN);

		const token = randomToken();
		await ctx.runMutation(internal.sessions.startSession, {
			userId: user._id,
			tokenHash: await hashToken(token)
		});
		return token;
	}
});

export const signup = action({
	args: { invite: v.string(), username: v.string(), password: v.string() },
	handler: async (ctx, args): Promise<string> => {
		const username = normalizeUsername(args.username);
		if (!/^[a-z0-9_-]{2,32}$/.test(username)) {
			throw new ConvexError('usernames are 2–32 letters, numbers, - or _');
		}
		checkNewPassword(args.password);
		// Cheap check before the slow hash; createAccount re-checks atomically
		const inviteHash = await hashToken(args.invite);
		if (!(await ctx.runQuery(internal.sessions.inviteExists, { inviteHash }))) {
			throw new ConvexError(INVALID_INVITE);
		}

		const token = randomToken();
		await ctx.runMutation(internal.sessions.createAccount, {
			inviteHash,
			username,
			passwordHash: await hashPassword(args.password),
			tokenHash: await hashToken(token)
		});
		return token;
	}
});

// A separate session for the browser extension, so it never needs the password.
// Replaces the previous extension session, so old tokens stop working.
export const createExtensionToken = action({
	args: { token: v.string() },
	handler: async (ctx, args): Promise<string> => {
		const token = randomToken();
		await ctx.runMutation(internal.sessions.startExtensionSession, {
			callerTokenHash: await hashToken(args.token),
			tokenHash: await hashToken(token)
		});
		return token;
	}
});

// Other sessions (other browsers, the extension) stay signed in; signOutOthers ends them
export const changePassword = action({
	args: { token: v.string(), currentPassword: v.string(), newPassword: v.string() },
	handler: async (ctx, args) => {
		checkNewPassword(args.newPassword);
		const user = await ctx.runQuery(internal.sessions.getUserBySession, {
			tokenHash: await hashToken(args.token)
		});
		if (!user) throw new ConvexError('Unauthorized');
		await checkPassword(ctx, user, args.currentPassword, 'current password is wrong');
		await ctx.runMutation(internal.users.setPasswordHash, {
			username: user.username,
			passwordHash: await hashPassword(args.newPassword)
		});
	}
});

// Holding the token is the authority to end its session
export const logout = mutation({
	args: { token: v.string() },
	handler: async (ctx, args) => {
		const tokenHash = await hashToken(args.token);
		const session = await ctx.db
			.query('sessions')
			.withIndex('by_tokenHash', (q) => q.eq('tokenHash', tokenHash))
			.unique();
		if (session) await ctx.db.delete(session._id);
	}
});

// Ends every session but the caller's, extension included
export const signOutOthers = mutation({
	args: { token: v.string() },
	handler: async (ctx, args) => {
		const userId = await requireUser(ctx, args.token);
		const tokenHash = await hashToken(args.token);
		const sessions = await ctx.db
			.query('sessions')
			.withIndex('by_user', (q) => q.eq('userId', userId))
			.collect();
		for (const session of sessions) {
			if (session.tokenHash !== tokenHash) await ctx.db.delete(session._id);
		}
	}
});

export const getUserBySession = internalQuery({
	args: { tokenHash: v.string() },
	handler: async (ctx, args) => {
		const session = await ctx.db
			.query('sessions')
			.withIndex('by_tokenHash', (q) => q.eq('tokenHash', args.tokenHash))
			.unique();
		return session && (await ctx.db.get(session.userId));
	}
});

export const getUserByUsername = internalQuery({
	args: { username: v.string() },
	handler: async (ctx, args) => {
		return await ctx.db
			.query('users')
			.withIndex('by_username', (q) => q.eq('username', args.username))
			.unique();
	}
});

export const inviteExists = internalQuery({
	args: { inviteHash: v.string() },
	handler: async (ctx, args) => {
		const invite = await ctx.db
			.query('invites')
			.withIndex('by_codeHash', (q) => q.eq('codeHash', args.inviteHash))
			.unique();
		return invite !== null;
	}
});

// After MAX_FAILED_LOGINS uncleared attempts, allows one per LOCKOUT_MS
export const countAttempt = internalMutation({
	args: { userId: v.id('users') },
	handler: async (ctx, args) => {
		const user = await ctx.db.get(args.userId);
		if (!user) throw new ConvexError(WRONG_LOGIN);
		const now = Date.now();
		const attempts = user.failedLogins ?? 0;
		if (attempts >= MAX_FAILED_LOGINS && now - (user.lastFailedLogin ?? 0) < LOCKOUT_MS) {
			throw new ConvexError('too many attempts, try again later');
		}
		await ctx.db.patch(args.userId, { failedLogins: attempts + 1, lastFailedLogin: now });
	}
});

export const startSession = internalMutation({
	args: { userId: v.id('users'), tokenHash: v.string() },
	handler: async (ctx, args) => {
		await ctx.db.patch(args.userId, { failedLogins: undefined, lastFailedLogin: undefined });
		await ctx.db.insert('sessions', args);
	}
});

export const startExtensionSession = internalMutation({
	args: { callerTokenHash: v.string(), tokenHash: v.string() },
	handler: async (ctx, args) => {
		const caller = await ctx.db
			.query('sessions')
			.withIndex('by_tokenHash', (q) => q.eq('tokenHash', args.callerTokenHash))
			.unique();
		if (!caller) throw new ConvexError('Unauthorized');
		const sessions = await ctx.db
			.query('sessions')
			.withIndex('by_user', (q) => q.eq('userId', caller.userId))
			.collect();
		for (const session of sessions) {
			if (session.extension) await ctx.db.delete(session._id);
		}
		await ctx.db.insert('sessions', {
			userId: caller.userId,
			tokenHash: args.tokenHash,
			extension: true
		});
	}
});

export const createAccount = internalMutation({
	args: {
		inviteHash: v.string(),
		username: v.string(),
		passwordHash: v.string(),
		tokenHash: v.string()
	},
	handler: async (ctx, args) => {
		const invite = await ctx.db
			.query('invites')
			.withIndex('by_codeHash', (q) => q.eq('codeHash', args.inviteHash))
			.unique();
		if (!invite) throw new ConvexError(INVALID_INVITE);
		const taken = await ctx.db
			.query('users')
			.withIndex('by_username', (q) => q.eq('username', args.username))
			.unique();
		if (taken) throw new ConvexError('that username is taken');

		await ctx.db.delete(invite._id);
		const userId = await ctx.db.insert('users', {
			username: args.username,
			passwordHash: args.passwordHash
		});
		await ctx.db.insert('sessions', { userId, tokenHash: args.tokenHash });
	}
});
