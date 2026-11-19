import { ConvexError, v } from 'convex/values';
import {
	internalAction,
	internalMutation,
	internalQuery,
	type MutationCtx
} from './_generated/server';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { deleteEmbedding } from './embeddings';
import { deleteItem } from './items';
import { r2 } from './r2';
import {
	clearLoginAttempts,
	DUMMY_PASSWORD_HASH,
	hashPassword,
	hashToken,
	normalizeUsername,
	randomToken,
	requireUser,
	sessionByTokenHash,
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
		return { ended: await endSessions(ctx, user._id) };
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

async function endSessions(ctx: MutationCtx, userId: Id<'users'>) {
	const sessions = await ctx.db
		.query('sessions')
		.withIndex('by_user', (q) => q.eq('userId', userId))
		.collect();
	for (const session of sessions) await ctx.db.delete(session._id);
	return sessions.length;
}

async function getUser(ctx: MutationCtx, username: string) {
	const user = await userByUsername(ctx, username);
	if (!user) throw new ConvexError(`no user named ${username}`);
	return user;
}

// Account deletion (sessions.deleteAccount, once the password checks out).
// Signs the account out everywhere at once and stops it signing in again (no
// password matches the dummy hash), then leaves the data to deleteUserData.
export const startDeletion = internalMutation({
	args: { tokenHash: v.string() },
	handler: async (ctx, { tokenHash }) => {
		const session = await sessionByTokenHash(ctx, tokenHash);
		if (!session) throw new ConvexError('Unauthorized');
		await endSessions(ctx, session.userId);
		await ctx.db.patch(session.userId, { passwordHash: DUMMY_PASSWORD_HASH });
		await ctx.scheduler.runAfter(0, internal.users.deleteUserData, { userId: session.userId });
	}
});

// Rows a run deletes from one table; an item counts for more, as it takes its
// memberships, embedding and up to three R2 objects with it
const DELETE_BATCH = 100;
const ITEM_BATCH = 25;

// Deletes a batch of the user's data and runs again until none is left, then
// deletes the user
export const deleteUserData = internalMutation({
	args: { userId: v.id('users') },
	handler: async (ctx, { userId }) => {
		if (await deleteUserBatch(ctx, userId)) {
			await ctx.scheduler.runAfter(0, internal.users.deleteUserData, { userId });
		}
	}
});

// Returns whether there may be more to delete
async function deleteUserBatch(ctx: MutationCtx, userId: Id<'users'>) {
	// Collections first, so their shared links stop working early. Their
	// memberships go as they are: the items they'd be patched off go next.
	const collection = await ctx.db
		.query('collections')
		.withIndex('by_user_position', (q) => q.eq('userId', userId))
		.first();
	if (collection) {
		const positions = await ctx.db
			.query('itemCollectionPositions')
			.withIndex('by_collection', (q) => q.eq('collectionId', collection._id))
			.take(DELETE_BATCH);
		for (const position of positions) await ctx.db.delete(position._id);
		if (positions.length < DELETE_BATCH) await ctx.db.delete(collection._id);
		return true;
	}

	const items = await ctx.db
		.query('items')
		.withIndex('by_user_dateAdded', (q) => q.eq('userId', userId))
		.take(ITEM_BATCH);
	for (const item of items) await deleteItem(ctx, item);
	if (items.length > 0) return true;

	// The rest is a few rows a table (embeddings went with their items), all
	// deleted with the user in one go, so a run that lands late (a map layout,
	// say) finds the user gone rather than leaving a row behind
	const rest = await Promise.all([
		ctx.db
			.query('uploads')
			.withIndex('by_user', (q) => q.eq('userId', userId))
			.take(DELETE_BATCH),
		ctx.db
			.query('itemEmbeddings')
			.withIndex('by_user', (q) => q.eq('userId', userId))
			.take(DELETE_BATCH),
		ctx.db
			.query('viewPreferences')
			.withIndex('by_user_key', (q) => q.eq('userId', userId))
			.take(DELETE_BATCH),
		ctx.db
			.query('sessions')
			.withIndex('by_user', (q) => q.eq('userId', userId))
			.take(DELETE_BATCH),
		ctx.db
			.query('embeddingMapStates')
			.withIndex('by_user', (q) => q.eq('userId', userId))
			.take(DELETE_BATCH),
		ctx.db
			.query('embeddingMapLayouts')
			.withIndex('by_user', (q) => q.eq('userId', userId))
			.take(DELETE_BATCH)
	]);
	const [uploads, embeddings, ...others] = rest;
	for (const upload of uploads) {
		await r2.deleteObject(ctx, upload.key);
		await ctx.db.delete(upload._id);
	}
	for (const row of embeddings) await deleteEmbedding(ctx, row);
	for (const row of others.flat()) await ctx.db.delete(row._id);
	if (rest.some((rows) => rows.length === DELETE_BATCH)) return true;

	const user = await ctx.db.get(userId);
	if (user) {
		await clearLoginAttempts(ctx, user.username);
		await ctx.db.delete(userId);
	}
	return false;
}
