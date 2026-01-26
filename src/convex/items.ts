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

// Build combined search text from title, description, and URL
function buildSearchText(fields: {
	title?: string;
	description?: string;
	url?: string;
}): string {
	return [fields.title, fields.description, fields.url].filter(Boolean).join(' ');
}

// Helper to get image URL from either R2 (imageKey) or legacy Convex storage (imageId)
export async function getImageUrl(ctx: QueryCtx, item: Doc<'items'>): Promise<string | null> {
	if (item.imageKey) {
		// Set expiration to 24 hours to reduce URL regeneration
		return await r2.getUrl(item.imageKey, { expiresIn: 60 * 60 * 24 });
	}
	if (item.imageId) {
		return await ctx.storage.getUrl(item.imageId);
	}
	return null;
}

// Add a new item
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
		collections: v.optional(v.array(v.id('collections')))
	},
	handler: async (ctx, args) => {
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

// Update an existing item
export const update = mutation({
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

// Delete an item
export const remove = mutation({
	args: { id: v.id('items') },
	handler: async (ctx, args) => {
		const item = await ctx.db.get(args.id);
		if (!item) throw new Error('Item not found');

		// Delete all position records for this item
		await deleteAllPositionsForItem(ctx, args.id);

		// Delete associated image from R2 or legacy Convex storage
		if (item.imageKey) {
			await r2.deleteObject(ctx, item.imageKey);
		} else if (item.imageId) {
			await ctx.storage.delete(item.imageId);
		}

		await ctx.db.delete(args.id);
	}
});

// Add item to a collection
export const addToCollection = mutation({
	args: {
		itemId: v.id('items'),
		collectionId: v.id('collections')
	},
	handler: async (ctx, args) => {
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

// Remove item from a collection
export const removeFromCollection = mutation({
	args: {
		itemId: v.id('items'),
		collectionId: v.id('collections')
	},
	handler: async (ctx, args) => {
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

// Get all items
export const list = query({
	args: {},
	handler: async (ctx) => {
		const items = await ctx.db.query('items').order('desc').collect();
		// Get image URLs for items with images
		return Promise.all(
			items.map(async (item) => ({
				...item,
				imageUrl: await getImageUrl(ctx, item)
			}))
		);
	}
});

// Get a single item
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

// Get items in a specific collection, ordered by position or other sort options
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

		// Get positions ordered by position (lexicographically)
		const positions = await getPositionsByCollection(ctx, args.collectionId);

		// Create a map for quick position lookup
		const positionMap = new Map(positions.map((p) => [p.itemId as Id<'items'>, p.position]));

		// Fetch only the items in this collection using their IDs from positions
		const itemPromises = positions.map((p) => ctx.db.get(p.itemId));
		const items = await Promise.all(itemPromises);

		// Filter out null values (items that may have been deleted)
		const filtered = items.filter((item): item is NonNullable<typeof item> => item !== null);

		// Apply sorting based on sortBy option
		switch (sortBy) {
			case 'manual':
				// Sort by position (items without position go to the end)
				// Use simple string comparison (not localeCompare) to match fractional-indexing's expected ordering
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
					const titleA = (a.title ?? a.url ?? '').toLowerCase();
					const titleB = (b.title ?? b.url ?? '').toLowerCase();
					const titleCompare = titleA.localeCompare(titleB);
					if (titleCompare !== 0) return titleCompare;
					// Fall back to manual order for items with same title
					const posA = positionMap.get(a._id) ?? '\uffff';
					const posB = positionMap.get(b._id) ?? '\uffff';
					if (posA < posB) return -1;
					if (posA > posB) return 1;
					return 0;
				});
				break;
			case 'titleDesc':
				filtered.sort((a, b) => {
					const titleA = (a.title ?? a.url ?? '').toLowerCase();
					const titleB = (b.title ?? b.url ?? '').toLowerCase();
					const titleCompare = titleB.localeCompare(titleA);
					if (titleCompare !== 0) return titleCompare;
					// Fall back to manual order for items with same title
					const posA = positionMap.get(a._id) ?? '\uffff';
					const posB = positionMap.get(b._id) ?? '\uffff';
					if (posA < posB) return -1;
					if (posA > posB) return 1;
					return 0;
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

// Search items by title/description
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
