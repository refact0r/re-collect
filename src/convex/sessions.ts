import { ConvexError, v } from 'convex/values';
import { action, internalMutation, internalQuery, mutation } from './_generated/server';
import { internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import {
	clearLoginAttempts,
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
// A username's count is forgotten a day after its last attempt
const FORGET_ATTEMPTS_MS = 24 * 60 * 60 * 1000;
const SWEEP_BATCH = 500;
// Signup's limit, so no account has a longer name
const MAX_USERNAME_LENGTH = 32;

const WRONG_LOGIN = 'wrong username or password';
const INVALID_INVITE = 'this invite link is invalid or already used';

function checkNewPassword(password: string) {
	if (password.length < 8) throw new ConvexError('passwords need 8+ characters');
}

// Each returns a new session token for the SvelteKit server to keep in a cookie
export const login = action({
	args: { username: v.string(), password: v.string() },
	handler: async (ctx, args): Promise<string> => {
		const username = normalizeUsername(args.username);
		if (username.length > MAX_USERNAME_LENGTH) throw new ConvexError(WRONG_LOGIN);
		// The same path for every name: count, then the slow hash (a dummy one
		// when nobody has the name), so a made-up name looks like a real one
		const user: Doc<'users'> | null = await ctx.runMutation(internal.sessions.countAttempt, {
			username
		});
		const ok = await verifyPassword(args.password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
		if (!user || !ok) throw new ConvexError(WRONG_LOGIN);

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
		await ctx.runMutation(internal.sessions.countAttempt, { username: user.username });
		if (!(await verifyPassword(args.currentPassword, user.passwordHash))) {
			throw new ConvexError('current password is wrong');
		}
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

// Counts a password attempt toward the username's lockout, then returns its
// user (null if nobody has the name). Counting runs before the slow hash and
// in this one mutation, so parallel guesses can't all slip in under the limit,
// and it keys on the name rather than the account, so a made-up name locks
// exactly like a real one. After MAX_FAILED_LOGINS uncleared attempts, allows
// one per LOCKOUT_MS.
export const countAttempt = internalMutation({
	args: { username: v.string() },
	handler: async (ctx, { username }) => {
		const now = Date.now();
		const row = await ctx.db
			.query('loginAttempts')
			.withIndex('by_username', (q) => q.eq('username', username))
			.unique();
		const live = row && now - row.lastAttempt < FORGET_ATTEMPTS_MS ? row : null;
		if (live && live.count >= MAX_FAILED_LOGINS && now - live.lastAttempt < LOCKOUT_MS) {
			throw new ConvexError('too many attempts, try again later');
		}
		const count = (live?.count ?? 0) + 1;
		if (row) await ctx.db.patch(row._id, { count, lastAttempt: now });
		else await ctx.db.insert('loginAttempts', { username, count, lastAttempt: now });

		return await ctx.db
			.query('users')
			.withIndex('by_username', (q) => q.eq('username', username))
			.unique();
	}
});

// Daily (crons.ts): forgets names nobody has tried for FORGET_ATTEMPTS_MS,
// mostly made-up ones that would otherwise pile up
export const sweepLoginAttempts = internalMutation({
	args: {},
	handler: async (ctx) => {
		const stale = await ctx.db
			.query('loginAttempts')
			.withIndex('by_lastAttempt', (q) => q.lt('lastAttempt', Date.now() - FORGET_ATTEMPTS_MS))
			.take(SWEEP_BATCH);
		for (const row of stale) await ctx.db.delete(row._id);
		if (stale.length === SWEEP_BATCH) {
			await ctx.scheduler.runAfter(0, internal.sessions.sweepLoginAttempts, {});
		}
	}
});

export const startSession = internalMutation({
	args: { userId: v.id('users'), tokenHash: v.string() },
	handler: async (ctx, args) => {
		const user = await ctx.db.get(args.userId);
		if (user) await clearLoginAttempts(ctx, user.username);
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
