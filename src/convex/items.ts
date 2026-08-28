import { v } from 'convex/values';
import { query } from './_generated/server';
import type { Doc } from './_generated/dataModel';
import { internal } from './_generated/api';
import { r2 } from './r2';
import {
	addItemToCollection,
	removeItemFromCollection,
	deleteAllPositionsForItem,
	getPositionsByCollection
} from './itemCollectionPositions';
import { authedMutation } from './lib/auth';
import { buildSearchText } from './lib/searchText';
import { enqueueScreenshot } from './screenshots';
import { getPreferences } from './viewPreferences';
import { sortModeValidator, collectionSortModeValidator } from './schema';

// Get a sortable title string from an item
function getSortTitle(item: { title?: string; url?: string }): string {
	return (item.title ?? item.url ?? '').toLowerCase();
}

export function getImageUrl(item: Doc<'items'>): string | null {
	if (item.imageKey) {
		return `${process.env.R2_PUBLIC_URL}/${item.imageKey}`;
	}
	return null;
}

export const add = authedMutation({
	args: {
		type: v.union(v.literal('url'), v.literal('image'), v.literal('text')),
		title: v.optional(v.string()),
		description: v.optional(v.string()),
		url: v.optional(v.string()),
		content: v.optional(v.string()),
		imageKey: v.optional(v.string()),
		imageWidth: v.optional(v.number()),
		imageHeight: v.optional(v.number()),
		collections: v.optional(v.array(v.id('collections')))
	},
	handler: async (ctx, args) => {
		const now = Date.now();
		const collections = args.collections ?? [];

		// Ingestion prefs come from the first collection at add time (or the home
		// defaults for collection-less adds) and are snapshotted onto the item;
		// later membership changes don't re-apply them.
		const defaultsSource = collections[0]
			? await ctx.db.get(collections[0])
			: await getPreferences(ctx, 'home');
		// 'text' tagging only applies to URL items; images in a text-mode
		// collection fall back to visual tagging
		const rawTaggingMode = defaultsSource?.taggingMode;
		const taggingMode =
			args.type === 'image' && rawTaggingMode === 'text' ? 'visual' : rawTaggingMode;
		const linkImageMode = defaultsSource?.linkImageMode;
		const wantsTagging = taggingMode !== 'none';
		const wantsTextTagging = args.type === 'url' && !!args.url && taggingMode === 'text';

		// URL items in visual mode: screenshot/og image lands first, then tagging
		// runs against it. Text mode tags off the article, in parallel with the
		// image fetch. Image items: tagging runs directly off the uploaded image.
		const screenshotFields =
			args.type === 'url' && args.url ? { screenshotStatus: 'pending' as const } : {};
		const taggingFields =
			(args.type === 'image' && args.imageKey && wantsTagging) || wantsTextTagging
				? { taggingStatus: 'pending' as const }
				: {};

		const itemId = await ctx.db.insert('items', {
			type: args.type,
			title: args.title,
			description: args.description,
			url: args.url,
			content: args.content,
			imageKey: args.imageKey,
			imageWidth: args.imageWidth,
			imageHeight: args.imageHeight,
			...screenshotFields,
			...taggingFields,
			taggingMode: args.type !== 'text' ? taggingMode : undefined,
			linkImageMode: args.type === 'url' ? linkImageMode : undefined,
			searchText: buildSearchText({
				title: args.title,
				description: args.description,
				url: args.url
			}),
			collections: [],
			dateAdded: now,
			dateModified: now
		});

		// Membership bookkeeping (positions, collections array, counts) lives in the helper
		for (const collectionId of collections) {
			await addItemToCollection(ctx, itemId, collectionId);
		}

		// Trigger screenshot/og image generation for URL items
		if (args.type === 'url' && args.url) {
			await enqueueScreenshot(ctx, { itemId, url: args.url, mode: linkImageMode });
		}

		// Trigger tagging for image items (palette always runs, even untagged).
		// URL items in visual mode wait for their image to land.
		if (args.type === 'image' && args.imageKey) {
			await ctx.scheduler.runAfter(
				0,
				wantsTagging
					? internal.taggingActions.preprocessItem
					: internal.taggingActions.repaletteItem,
				{ itemId }
			);
		}

		// Text-mode tagging runs off the article content, independent of the image
		if (wantsTextTagging) {
			await ctx.scheduler.runAfter(0, internal.tagging.tagTextItem, { itemId });
		}

		return itemId;
	}
});

export const update = authedMutation({
	args: {
		id: v.id('items'),
		title: v.optional(v.string()),
		description: v.optional(v.string()),
		url: v.optional(v.string()),
		content: v.optional(v.string()),
		collections: v.optional(v.array(v.id('collections')))
	},
	handler: async (ctx, args) => {
		const { id, collections, ...updates } = args;
		const existing = await ctx.db.get(id);
		if (!existing) throw new Error('Item not found');

		// Handle collection changes if collections array is provided
		if (collections !== undefined) {
			const oldCollections = new Set(existing.collections);
			const newCollections = new Set(collections);

			for (const collectionId of newCollections) {
				if (!oldCollections.has(collectionId)) {
					await addItemToCollection(ctx, id, collectionId);
				}
			}

			for (const collectionId of oldCollections) {
				if (!newCollections.has(collectionId)) {
					await removeItemFromCollection(ctx, id, collectionId);
				}
			}
		}

		const newTitle = args.title ?? existing.title;
		const newDescription = args.description ?? existing.description;
		const newUrl = args.url ?? existing.url;

		await ctx.db.patch(id, {
			...updates,
			searchText: buildSearchText({
				title: newTitle,
				description: newDescription,
				ogDescription: existing.ogDescription,
				url: newUrl,
				styles: existing.styles,
				aiTags: existing.aiTags,
				subject: existing.subject,
				paletteNames: existing.paletteNames
			}),
			dateModified: Date.now()
		});
	}
});

export const remove = authedMutation({
	args: { id: v.id('items') },
	handler: async (ctx, args) => {
		const item = await ctx.db.get(args.id);
		if (!item) throw new Error('Item not found');

		// Delete all position records for this item
		await deleteAllPositionsForItem(ctx, args.id);

		// Delete associated image from R2
		if (item.imageKey) {
			await r2.deleteObject(ctx, item.imageKey);
		}

		await ctx.db.delete(args.id);
	}
});

export const addToCollection = authedMutation({
	args: {
		itemId: v.id('items'),
		collectionId: v.id('collections')
	},
	handler: async (ctx, args) => {
		await addItemToCollection(ctx, args.itemId, args.collectionId);
	}
});

export const removeFromCollection = authedMutation({
	args: {
		itemId: v.id('items'),
		collectionId: v.id('collections')
	},
	handler: async (ctx, args) => {
		await removeItemFromCollection(ctx, args.itemId, args.collectionId);
	}
});

export const list = query({
	args: {
		sortBy: v.optional(sortModeValidator),
		collectionIds: v.optional(v.array(v.id('collections'))),
		includeUncollected: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		const sortBy = args.sortBy ?? 'dateAddedNewest';

		let items: Doc<'items'>[];
		switch (sortBy) {
			case 'dateAddedNewest':
				items = await ctx.db.query('items').withIndex('by_dateAdded').order('desc').collect();
				break;
			case 'dateAddedOldest':
				items = await ctx.db.query('items').withIndex('by_dateAdded').order('asc').collect();
				break;
			case 'dateModifiedNewest':
				items = await ctx.db.query('items').withIndex('by_dateModified').order('desc').collect();
				break;
			case 'dateModifiedOldest':
				items = await ctx.db.query('items').withIndex('by_dateModified').order('asc').collect();
				break;
			case 'titleAsc':
				items = await ctx.db.query('items').collect();
				items.sort((a, b) => getSortTitle(a).localeCompare(getSortTitle(b)));
				break;
			case 'titleDesc':
				items = await ctx.db.query('items').collect();
				items.sort((a, b) => getSortTitle(b).localeCompare(getSortTitle(a)));
				break;
		}

		if (args.collectionIds && args.collectionIds.length > 0) {
			const filterSet = new Set(args.collectionIds);
			items = items.filter(
				(item) =>
					item.collections.some((c) => filterSet.has(c)) ||
					(args.includeUncollected === true && item.collections.length === 0)
			);
		} else if (args.includeUncollected === false) {
			items = items.filter((item) => item.collections.length > 0);
		}

		return items.map((item) => ({
			...item,
			imageUrl: getImageUrl(item)
		}));
	}
});

export const listByCollection = query({
	args: {
		collectionId: v.id('collections'),
		sortBy: v.optional(collectionSortModeValidator)
	},
	handler: async (ctx, args) => {
		const sortBy = args.sortBy ?? 'manual';

		const positions = await getPositionsByCollection(ctx, args.collectionId);
		const positionMap = new Map(positions.map((p) => [p.itemId, p.position]));

		const items = await Promise.all(positions.map((p) => ctx.db.get(p.itemId)));
		const filtered = items.filter((item): item is NonNullable<typeof item> => item !== null);

		switch (sortBy) {
			case 'manual':
				filtered.sort((a, b) => {
					const posA = positionMap.get(a._id) ?? '\uffff'; // Use high Unicode char for items without position
					const posB = positionMap.get(b._id) ?? '\uffff';
					if (posA < posB) return -1;
					if (posA > posB) return 1;
					return 0;
				});
				break;
			case 'dateAddedNewest':
				filtered.sort((a, b) => b.dateAdded - a.dateAdded);
				break;
			case 'dateAddedOldest':
				filtered.sort((a, b) => a.dateAdded - b.dateAdded);
				break;
			case 'dateModifiedNewest':
				filtered.sort((a, b) => b.dateModified - a.dateModified);
				break;
			case 'dateModifiedOldest':
				filtered.sort((a, b) => a.dateModified - b.dateModified);
				break;
			case 'titleAsc':
				filtered.sort((a, b) => {
					const cmp = getSortTitle(a).localeCompare(getSortTitle(b));
					if (cmp !== 0) return cmp;
					const posA = positionMap.get(a._id) ?? '\uffff';
					const posB = positionMap.get(b._id) ?? '\uffff';
					return posA < posB ? -1 : posA > posB ? 1 : 0;
				});
				break;
			case 'titleDesc':
				filtered.sort((a, b) => {
					const cmp = getSortTitle(b).localeCompare(getSortTitle(a));
					if (cmp !== 0) return cmp;
					const posA = positionMap.get(a._id) ?? '\uffff';
					const posB = positionMap.get(b._id) ?? '\uffff';
					return posA < posB ? -1 : posA > posB ? 1 : 0;
				});
				break;
		}

		return filtered.map((item) => ({
			...item,
			imageUrl: getImageUrl(item),
			position: positionMap.get(item._id)
		}));
	}
});

export const search = query({
	args: { query: v.string() },
	handler: async (ctx, args) => {
		if (!args.query.trim()) {
			return [];
		}
		const results = await ctx.db
			.query('items')
			.withSearchIndex('search_items', (q) => q.search('searchText', args.query))
			.take(50);

		return results.map((item) => ({
			...item,
			imageUrl: getImageUrl(item)
		}));
	}
});
