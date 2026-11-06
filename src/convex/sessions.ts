import { ConvexError, v } from 'convex/values';
import { action, internalMutation, internalQuery, mutation } from './_generated/server';
import { internal } from './_generated/api';
import {
	hashPassword,
	hashToken,
	normalizeUsername,
	randomToken,
	verifyPassword
} from './lib/auth';

// After this many wrong passwords in a row, each further attempt waits out the lockout
const MAX_FAILED_LOGINS = 10;
const LOCKOUT_MS = 15 * 60 * 1000;

const WRONG_LOGIN = 'wrong username or password';

// Each returns a new session token for the SvelteKit server to keep in a cookie
export const login = action({
	args: { username: v.string(), password: v.string() },
	handler: async (ctx, args): Promise<string> => {
		const now = Date.now();
		const user = await ctx.runQuery(internal.sessions.getUserByUsername, {
			username: normalizeUsername(args.username)
		});
		if (!user) throw new ConvexError(WRONG_LOGIN);
		if (
			(user.failedLogins ?? 0) >= MAX_FAILED_LOGINS &&
			now - (user.lastFailedLogin ?? 0) < LOCKOUT_MS
		) {
			throw new ConvexError('too many attempts, try again later');
		}
		if (!(await verifyPassword(args.password, user.passwordHash))) {
			await ctx.runMutation(internal.sessions.recordFailedLogin, { userId: user._id, now });
			throw new ConvexError(WRONG_LOGIN);
		}

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
		if (args.password.length < 8) throw new ConvexError('passwords need 8+ characters');

		const token = randomToken();
		await ctx.runMutation(internal.sessions.createAccount, {
			inviteHash: await hashToken(args.invite),
			username,
			passwordHash: await hashPassword(args.password),
			tokenHash: await hashToken(token)
		});
		return token;
	}
});

// A separate session for the browser extension, so it never needs the password
export const createExtensionToken = action({
	args: { token: v.string() },
	handler: async (ctx, args): Promise<string> => {
		const token = randomToken();
		await ctx.runMutation(internal.sessions.startSessionFrom, {
			callerTokenHash: await hashToken(args.token),
			tokenHash: await hashToken(token)
		});
		return token;
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

export const getUserByUsername = internalQuery({
	args: { username: v.string() },
	handler: async (ctx, args) => {
		return await ctx.db
			.query('users')
			.withIndex('by_username', (q) => q.eq('username', args.username))
			.unique();
	}
});

export const recordFailedLogin = internalMutation({
	args: { userId: v.id('users'), now: v.number() },
	handler: async (ctx, args) => {
		const user = await ctx.db.get(args.userId);
		if (!user) return;
		await ctx.db.patch(args.userId, {
			failedLogins: (user.failedLogins ?? 0) + 1,
			lastFailedLogin: args.now
		});
	}
});

export const startSession = internalMutation({
	args: { userId: v.id('users'), tokenHash: v.string() },
	handler: async (ctx, args) => {
		await ctx.db.patch(args.userId, { failedLogins: undefined, lastFailedLogin: undefined });
		await ctx.db.insert('sessions', args);
	}
});

export const startSessionFrom = internalMutation({
	args: { callerTokenHash: v.string(), tokenHash: v.string() },
	handler: async (ctx, args) => {
		const caller = await ctx.db
			.query('sessions')
			.withIndex('by_tokenHash', (q) => q.eq('tokenHash', args.callerTokenHash))
			.unique();
		if (!caller) throw new ConvexError('Unauthorized');
		await ctx.db.insert('sessions', { userId: caller.userId, tokenHash: args.tokenHash });
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
		if (!invite) throw new ConvexError('this invite link is invalid or already used');
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
