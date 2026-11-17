import { v } from 'convex/values';
import { userMutation, userQuery, type UserQueryCtx } from './lib/auth';
import { taggingModeValidator, linkImageModeValidator, sortModeValidator } from './schema';

export async function getPreferences(ctx: UserQueryCtx, key: string) {
	return await ctx.db
		.query('viewPreferences')
		.withIndex('by_user_key', (q) => q.eq('userId', ctx.userId).eq('key', key))
		.unique();
}

export const get = userQuery({
	args: { key: v.string() },
	handler: async (ctx, args) => {
		return await getPreferences(ctx, args.key);
	}
});

export const set = userMutation({
	args: {
		// The pages that keep a row (collections keep theirs on the collection doc)
		key: v.union(v.literal('home'), v.literal('search'), v.literal('discover')),
		sortMode: v.optional(sortModeValidator),
		viewMode: v.optional(v.union(v.literal('grid'), v.literal('list'))),
		columnOffset: v.optional(v.number()),
		showTitles: v.optional(v.boolean()),
		filterCollectionIds: v.optional(v.array(v.id('collections'))),
		includeUncollected: v.optional(v.boolean()),
		taggingMode: v.optional(taggingModeValidator),
		linkImageMode: v.optional(linkImageModeValidator)
	},
	handler: async (ctx, args) => {
		const { key, ...updates } = args;
		const existing = await getPreferences(ctx, key);
		if (existing) {
			await ctx.db.patch(existing._id, updates);
		} else {
			await ctx.db.insert('viewPreferences', { userId: ctx.userId, key, ...updates });
		}
	}
});
