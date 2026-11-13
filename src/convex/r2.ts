import { R2 } from '@convex-dev/r2';
import { v } from 'convex/values';
import { components } from './_generated/api';
import { userMutation, type UserQueryCtx } from './lib/auth';

export const r2 = new R2(components.r2);

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

export const syncMetadata = userMutation({
	args: { key: v.string() },
	handler: async (ctx, args) => {
		if (!(await getOwnUpload(ctx, args.key))) throw new Error('Upload not found');
		await ctx.scheduler.runAfter(0, components.r2.lib.syncMetadata, {
			key: args.key,
			...r2.config
		});
	}
});
