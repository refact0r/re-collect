import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { requireAuth } from './auth';

export const get = query({
	args: { key: v.string() },
	handler: async (ctx, args) => {
		const result = await ctx.db
			.query('viewPreferences')
			.withIndex('by_key', (q) => q.eq('key', args.key))
			.unique();
		return result;
	}
});

export const set = mutation({
	args: {
		key: v.string(),
		sortMode: v.optional(
			v.union(
				v.literal('dateAddedNewest'),
				v.literal('dateAddedOldest'),
				v.literal('dateModifiedNewest'),
				v.literal('dateModifiedOldest'),
				v.literal('titleAsc'),
				v.literal('titleDesc')
			)
		),
		viewMode: v.optional(v.union(v.literal('grid'), v.literal('list'))),
		filterCollectionIds: v.optional(v.array(v.id('collections'))),
		includeUncollected: v.optional(v.boolean()),
		token: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		requireAuth(args.token);
		const { key, token, ...updates } = args;
		const existing = await ctx.db
			.query('viewPreferences')
			.withIndex('by_key', (q) => q.eq('key', key))
			.unique();
		if (existing) {
			await ctx.db.patch(existing._id, updates);
		} else {
			await ctx.db.insert('viewPreferences', { key, ...updates });
		}
	}
});
