'use node';

import { ConvexError, v } from 'convex/values';
import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { action } from './_generated/server';
import { fetchImage, upload } from './imageImport';

// Keeps a discovery candidate: its media is copied into R2 (it was only
// hotlinked until now) and it becomes an ordinary library item. A site keeps as
// a URL item with that image; anything else as an image item linking back.
// Saved under the candidate's own URL, so the feed drops it from then on.
export const keep = action({
	args: {
		candidateId: v.id('discoveryCandidates'),
		collectionId: v.optional(v.id('collections')),
		token: v.string()
	},
	returns: v.id('items'),
	handler: async (ctx, { candidateId, collectionId, token }): Promise<Id<'items'>> => {
		await ctx.runQuery(internal.users.userForToken, { token });
		const candidate = await ctx.runQuery(internal.discovery.getCandidate, { candidateId });
		if (!candidate) throw new ConvexError('that post is gone');

		const collections = collectionId ? [collectionId] : undefined;
		const text = { title: candidate.title, ogDescription: candidate.description };
		try {
			const image = await fetchImage(candidate.imageUrl, candidate.url);
			const imageKey = await upload(ctx, image, token);
			return await ctx.runMutation(api.items.add, {
				type: candidate.kind === 'site' ? 'url' : 'image',
				url: candidate.url,
				...text,
				imageKey,
				imageWidth: image.width,
				imageHeight: image.height,
				collections,
				token
			});
		} catch (error) {
			if (error instanceof ConvexError && error.data === 'Unauthorized') throw error;
			// Without the source's image, the worker captures the page as usual
			console.warn(`discovery keep: ${candidate.imageUrl} failed, saving the page:`, error);
			return await ctx.runMutation(api.items.add, {
				type: 'url',
				url: candidate.url,
				...text,
				collections,
				token
			});
		}
	}
});
