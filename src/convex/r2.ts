import { R2 } from '@convex-dev/r2';
import { v } from 'convex/values';
import { components } from './_generated/api';
import { userMutation } from './lib/auth';

export const r2 = new R2(components.r2);

export const generateUploadUrl = userMutation({
	args: {},
	handler: async () => {
		return r2.generateUploadUrl();
	}
});

export const syncMetadata = userMutation({
	args: { key: v.string() },
	handler: async (ctx, args) => {
		await ctx.scheduler.runAfter(0, components.r2.lib.syncMetadata, {
			key: args.key,
			...r2.config
		});
	}
});
