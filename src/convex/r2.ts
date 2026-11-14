import { R2 } from '@convex-dev/r2';
import { components, internal } from './_generated/api';
import { internalMutation } from './_generated/server';
import { userMutation, type UserQueryCtx } from './lib/auth';

export const r2 = new R2(components.r2);

// Upload URLs expire after 15 minutes, so a row this old was abandoned
const UPLOAD_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const SWEEP_BATCH = 100;

// The caller's pending upload for `key`, or null if someone else minted it
export async function getOwnUpload(ctx: UserQueryCtx, key: string) {
	const upload = await ctx.db
		.query('uploads')
		.withIndex('by_key', (q) => q.eq('key', key))
		.unique();
	return upload?.userId === ctx.userId ? upload : null;
}

export const generateUploadUrl = userMutation({
	args: {},
	handler: async (ctx) => {
		const upload = await r2.generateUploadUrl();
		await ctx.db.insert('uploads', { userId: ctx.userId, key: upload.key });
		return upload;
	}
});

// Deletes uploads never attached to an item (abandoned, failed PUT, or an
// items.add that threw) with their objects. items.add deletes the row when it
// consumes a key, so no row here belongs to a live item.
export const sweepUploads = internalMutation({
	args: {},
	handler: async (ctx) => {
		const stale = await ctx.db
			.query('uploads')
			.withIndex('by_creation_time', (q) => q.lt('_creationTime', Date.now() - UPLOAD_MAX_AGE_MS))
			.take(SWEEP_BATCH);
		for (const upload of stale) {
			await r2.deleteObject(ctx, upload.key);
			await ctx.db.delete(upload._id);
		}
		if (stale.length === SWEEP_BATCH) {
			await ctx.scheduler.runAfter(0, internal.r2.sweepUploads, {});
		}
	}
});
