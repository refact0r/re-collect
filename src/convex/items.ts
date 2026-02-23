import { v } from 'convex/values';
import { mutation, query, type QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { internal } from './_generated/api';
import { r2 } from './r2';
import {
	addItemToCollectionWithPosition,
	removeItemFromCollectionWithPosition,
	deleteAllPositionsForItem,
	getPositionsByCollection
} from './itemCollectionPositions';
import { requireAuth } from './auth';

// Build combined search text from title, description, and URL
function buildSearchText(fields: {
	title?: string;
	description?: string;
	url?: string;
}): string {
	return [fields.title, fields.description, fields.url].filter(Boolean).join(' ');
}

// Get a sortable title string from an item
function getSortTitle(item: { title?: string; url?: string }): string {
	return (item.title ?? item.url ?? '').toLowerCase();
}

export async function getImageUrl(ctx: QueryCtx, item: Doc<'items'>): Promise<string | null> {
	if (item.imageKey) {
		return await r2.getUrl(item.imageKey, { expiresIn: 60 * 60 * 24 * 7 });
	}
	return null;
}

export const add = mutation({
	args: {
		type: v.union(v.literal('url'), v.literal('image'), v.literal('text')),
		title: v.optional(v.string()),
		description: v.optional(v.string()),
		url: v.optional(v.string()),
		content: v.optional(v.string()),
		imageKey: v.optional(v.string()),
		imageWidth: v.optional(v.number()),
		imageHeight: v.optional(v.number()),
		collections: v.optional(v.array(v.id('collections'))),
		token: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		requireAuth(args.token);
		const now = Date.now();
		const collections = args.collections ?? [];

		// For URL items, set initial screenshot status to pending
		const screenshotFields =
			args.type === 'url' && args.url
				? { screenshotStatus: 'pending' as const, screenshotRetries: 0 }
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
			searchText: buildSearchText({
				title: args.title,
				description: args.description,
				url: args.url
			}),
			collections,
			dateAdded: now,
			dateModified: now
		});

		// Create position records for each collection (item appears at top)
		for (const collectionId of collections) {
			await addItemToCollectionWithPosition(ctx, itemId, collectionId);
		}

		// Trigger screenshot generation for URL items
		if (args.type === 'url' && args.url) {
			await ctx.scheduler.runAfter(0, internal.screenshots.generateScreenshot, {
				itemId,
				url: args.url
			});
		}

		return itemId;
	}
});

export const update = mutation({
	args: {
		id: v.id('items'),
		title: v.optional(v.string()),
		description: v.optional(v.string()),
		url: v.optional(v.string()),
		content: v.optional(v.string()),
		collections: v.optional(v.array(v.id('collections'))),
		token: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		requireAuth(args.token);
		const { id, collections, token, ...updates } = args;
		const existing = await ctx.db.get(id);
		if (!existing) throw new Error('Item not found');

		// Handle collection changes if collections array is provided
		if (collections !== undefined) {
			const oldCollections = new Set(existing.collections);
			const newCollections = new Set(collections);

			// Add positions for newly added collections
			for (const collectionId of newCollections) {
				if (!oldCollections.has(collectionId)) {
					await addItemToCollectionWithPosition(ctx, id, collectionId);
				}
			}

			// Remove positions for removed collections
			for (const collectionId of oldCollections) {
				if (!newCollections.has(collectionId)) {
					await removeItemFromCollectionWithPosition(ctx, id, collectionId);
				}
			}
		}

		const newTitle = args.title ?? existing.title;
		const newDescription = args.description ?? existing.description;
		const newUrl = args.url ?? existing.url;

		await ctx.db.patch(id, {
			...updates,
			...(collections !== undefined && { collections }),
			searchText: buildSearchText({
				title: newTitle,
				description: newDescription,
				url: newUrl
			}),
			dateModified: Date.now()
		});
	}
});

export const remove = mutation({
	args: { id: v.id('items'), token: v.optional(v.string()) },
	handler: async (ctx, args) => {
		requireAuth(args.token);
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

export const addToCollection = mutation({
	args: {
		itemId: v.id('items'),
		collectionId: v.id('collections'),
		token: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		requireAuth(args.token);
		const item = await ctx.db.get(args.itemId);
		if (!item) throw new Error('Item not found');

		if (!item.collections.includes(args.collectionId)) {
			// Create position record (item appears at top)
			await addItemToCollectionWithPosition(ctx, args.itemId, args.collectionId);

			await ctx.db.patch(args.itemId, {
				collections: [...item.collections, args.collectionId],
				dateModified: Date.now()
			});
		}
	}
});

export const removeFromCollection = mutation({
	args: {
		itemId: v.id('items'),
		collectionId: v.id('collections'),
		token: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		requireAuth(args.token);
		const item = await ctx.db.get(args.itemId);
		if (!item) throw new Error('Item not found');

		// Delete position record
		await removeItemFromCollectionWithPosition(ctx, args.itemId, args.collectionId);

		await ctx.db.patch(args.itemId, {
			collections: item.collections.filter((c) => c !== args.collectionId),
			dateModified: Date.now()
		});
	}
});

export const list = query({
	args: {
		sortBy: v.optional(
			v.union(
				v.literal('dateAddedNewest'),
				v.literal('dateAddedOldest'),
				v.literal('dateModifiedNewest'),
				v.literal('dateModifiedOldest'),
				v.literal('titleAsc'),
				v.literal('titleDesc')
			)
		),
		collectionIds: v.optional(v.array(v.id('collections'))),
		includeUncollected: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		const sortBy = args.sortBy ?? 'dateAddedNewest';
		let items = await ctx.db.query('items').collect();

		if (args.collectionIds && args.collectionIds.length > 0) {
			const filterSet = new Set(args.collectionIds);
			items = items.filter(
				(item) =>
					item.collections.some((c) => filterSet.has(c)) ||
					(args.includeUncollected && item.collections.length === 0)
			);
		} else if (args.includeUncollected !== undefined && !args.includeUncollected) {
			items = items.filter((item) => item.collections.length > 0);
		}

		switch (sortBy) {
			case 'dateAddedNewest':
				items.sort((a, b) => b.dateAdded - a.dateAdded);
				break;
			case 'dateAddedOldest':
				items.sort((a, b) => a.dateAdded - b.dateAdded);
				break;
			case 'dateModifiedNewest':
				items.sort((a, b) => b.dateModified - a.dateModified);
				break;
			case 'dateModifiedOldest':
				items.sort((a, b) => a.dateModified - b.dateModified);
				break;
			case 'titleAsc':
				items.sort((a, b) => getSortTitle(a).localeCompare(getSortTitle(b)));
				break;
			case 'titleDesc':
				items.sort((a, b) => getSortTitle(b).localeCompare(getSortTitle(a)));
				break;
		}

		return Promise.all(
			items.map(async (item) => ({
				...item,
				imageUrl: await getImageUrl(ctx, item)
			}))
		);
	}
});

export const get = query({
	args: { id: v.id('items') },
	handler: async (ctx, args) => {
		const item = await ctx.db.get(args.id);
		if (!item) return null;
		return {
			...item,
			imageUrl: await getImageUrl(ctx, item)
		};
	}
});

export const listByCollection = query({
	args: {
		collectionId: v.id('collections'),
		sortBy: v.optional(
			v.union(
				v.literal('manual'),
				v.literal('dateAddedNewest'),
				v.literal('dateAddedOldest'),
				v.literal('dateModifiedNewest'),
				v.literal('dateModifiedOldest'),
				v.literal('titleAsc'),
				v.literal('titleDesc')
			)
		)
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

		return Promise.all(
			filtered.map(async (item) => ({
				...item,
				imageUrl: await getImageUrl(ctx, item),
				position: positionMap.get(item._id)
			}))
		);
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
			.collect();

		return Promise.all(
			results.map(async (item) => ({
				...item,
				imageUrl: await getImageUrl(ctx, item)
			}))
		);
	}
});
