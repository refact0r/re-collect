import { R2 } from '@convex-dev/r2';
import { v } from 'convex/values';
import { mutation } from './_generated/server';
import { components } from './_generated/api';
import { requireAuth } from './lib/auth';

export const r2 = new R2(components.r2);

export const generateUploadUrl = mutation({
	args: { token: v.optional(v.string()) },
	returns: v.object({ key: v.string(), url: v.string() }),
	handler: async (_ctx, args) => {
		requireAuth(args.token);
		return r2.generateUploadUrl();
	}
});

export const syncMetadata = mutation({
	args: { key: v.string(), token: v.optional(v.string()) },
	returns: v.null(),
	handler: async (ctx, args) => {
		requireAuth(args.token);
		await ctx.scheduler.runAfter(0, components.r2.lib.syncMetadata, {
			key: args.key,
			...r2.config
		});
		return null;
	}
});
