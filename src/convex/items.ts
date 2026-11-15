import { ConvexError, v, type Infer } from 'convex/values';
import type { Doc } from './_generated/dataModel';
import { internal } from './_generated/api';
import { internalMutation } from './_generated/server';
import { getOwnUpload, r2 } from './r2';
import {
	addItemToCollection,
	removeItemFromCollection,
	deleteAllPositionsForItem,
	getPositionsByCollection
} from './itemCollectionPositions';
import {
	getOwned,
	getViewable,
	userMutation,
	userQuery,
	viewerQuery,
	type ViewerQueryCtx
} from './lib/auth';
import { buildSearchText, patchItem } from './lib/searchText';
import { isWebUrl, normalizeUrl } from './lib/urls';
import { deleteItemEmbeddings, scheduleEmbedding } from './embeddings';
import { enqueueScreenshot } from './screenshots';
import { enqueueTagging } from './tagging';
import { getPreferences } from './viewPreferences';
import {
	sortModeValidator,
	collectionSortModeValidator,
	taggingModeValidator,
	linkImageModeValidator
} from './schema';

type Sortable = Pick<Doc<'items'>, 'title' | 'url' | 'dateAdded' | 'dateModified'>;

// `||`: older rows may hold title: ''
const sortTitle = (item: Sortable) => (item.title || item.url || '').toLowerCase();

const compareItems: Record<
	Infer<typeof sortModeValidator>,
	(a: Sortable, b: Sortable) => number
> = {
	dateAddedNewest: (a, b) => b.dateAdded - a.dateAdded,
	dateAddedOldest: (a, b) => a.dateAdded - b.dateAdded,
	dateModifiedNewest: (a, b) => b.dateModified - a.dateModified,
	dateModifiedOldest: (a, b) => a.dateModified - b.dateModified,
	titleAsc: (a, b) => sortTitle(a).localeCompare(sortTitle(b)),
	titleDesc: (a, b) => sortTitle(b).localeCompare(sortTitle(a))
};

export function getImageUrl(item: Doc<'items'>): string | null {
	if (item.imageKey) {
		return `${process.env.R2_PUBLIC_URL}/${item.imageKey}`;
	}
	return null;
}

// The item fields a visitor to someone else's shared collection gets: what the
// page shows. Anything else (the owner's other collections, user id, errors,
// search fields, fields added later) stays with the owner.
const VISITOR_FIELDS = [
	'_id',
	'_creationTime',
	'type',
	'title',
	'description',
	'ogDescription',
	'url',
	'content',
	'imageWidth',
	'imageHeight',
	'screenshotStatus',
	'styles',
	'subject',
	'aiTags',
	'paletteHex',
	'fonts',
	'taggingStatus',
	'dateAdded',
	'dateModified'
] as const satisfies readonly (keyof Doc<'items'>)[];

// An item as a listing returns it: the whole doc for its owner, the visitor
// fields (and an empty `collections`) for anyone else
export type ShownItem = Partial<Doc<'items'>> &
	Pick<Doc<'items'>, (typeof VISITOR_FIELDS)[number] | 'collections'> & {
		imageUrl: string | null;
	};

function forViewer(ctx: ViewerQueryCtx, item: Doc<'items'>): ShownItem {
	const imageUrl = getImageUrl(item);
	if (item.userId === ctx.viewerId) return { ...item, imageUrl };
	const shown = Object.fromEntries(VISITOR_FIELDS.map((field) => [field, item[field]]));
	return {
		...(shown as Pick<Doc<'items'>, (typeof VISITOR_FIELDS)[number]>),
		collections: [],
		imageUrl
	};
}

const LINK_ERROR = 'links must start with http:// or https://';

export const add = userMutation({
	args: {
		type: v.union(v.literal('url'), v.literal('image'), v.literal('text')),
		title: v.optional(v.string()),
		description: v.optional(v.string()),
		ogDescription: v.optional(v.string()),
		url: v.optional(v.string()),
		content: v.optional(v.string()),
		imageKey: v.optional(v.string()),
		imageWidth: v.optional(v.number()),
		imageHeight: v.optional(v.number()),
		collections: v.optional(v.array(v.id('collections'))),
		// Per-save overrides of the ingestion defaults below
		taggingMode: v.optional(taggingModeValidator),
		linkImageMode: v.optional(linkImageModeValidator)
	},
	handler: async (ctx, args) => {
		// A URL item needs a link, and any link must be http(s)
		if ((args.type === 'url' || args.url) && !isWebUrl(args.url ?? '')) {
			throw new ConvexError(LINK_ERROR);
		}
		const now = Date.now();
		const collections = args.collections ?? [];
		const ownedCollections = await Promise.all(collections.map((id) => getOwned(ctx, id)));
		if (ownedCollections.includes(null)) throw new ConvexError('collection not found');

		// Deleting an item deletes its R2 object, so a key must be the caller's own
		// fresh upload; consuming it ties the object to exactly this item
		if (args.imageKey) {
			const upload = args.type !== 'text' ? await getOwnUpload(ctx, args.imageKey) : null;
			if (!upload) throw new ConvexError('upload not found');
			await ctx.db.delete(upload._id);
		}

		// Ingestion prefs come from the caller's overrides, else the first
		// collection at add time (or the home defaults for collection-less adds),
		// and are snapshotted onto the item; later membership changes don't
		// re-apply them.
		const defaultsSource = ownedCollections[0] ?? (await getPreferences(ctx, 'home'));
		// Each type keeps only the modes it has: images in a text-mode collection
		// fall back to visual tagging, and notes (always read as content) only
		// record AI being off
		const rawTaggingMode = args.taggingMode ?? defaultsSource?.taggingMode;
		const taggingMode =
			args.type === 'text'
				? rawTaggingMode === 'none'
					? 'none'
					: undefined
				: args.type === 'image' && rawTaggingMode === 'text'
					? 'visual'
					: rawTaggingMode;
		const linkImageMode = args.linkImageMode ?? defaultsSource?.linkImageMode;
		const wantsTextTagging = args.type === 'url' && !!args.url && taggingMode === 'text';
		// URL items may arrive with their image already captured (the browser
		// extension's screenshot), which then stands in for the worker's
		const hasImage = args.type !== 'text' && !!args.imageKey;
		const wantsVisualTagging = hasImage && taggingMode !== 'none' && !wantsTextTagging;

		// URL items in visual mode: screenshot/og image lands first, then tagging
		// runs against it. Text mode tags off the article, in parallel with the
		// image fetch. Items with an image: tagging runs directly off it.
		const screenshotFields =
			args.type === 'url' && args.url
				? { screenshotStatus: hasImage ? ('completed' as const) : ('pending' as const) }
				: {};
		const taggingFields =
			wantsVisualTagging || wantsTextTagging ? { taggingStatus: 'pending' as const } : {};

		const itemId = await ctx.db.insert('items', {
			userId: ctx.userId,
			type: args.type,
			title: args.title,
			description: args.description,
			ogDescription: args.ogDescription,
			url: args.url,
			normUrl: args.url ? normalizeUrl(args.url) : undefined,
			content: args.content,
			imageKey: args.imageKey,
			imageWidth: args.imageWidth,
			imageHeight: args.imageHeight,
			...screenshotFields,
			...taggingFields,
			taggingMode,
			linkImageMode: args.type === 'url' ? linkImageMode : undefined,
			searchText: buildSearchText(args),
			collections: [],
			dateAdded: now,
			dateModified: now
		});

		// Membership bookkeeping (positions, collections array, counts) lives in the helper
		for (const collectionId of collections) {
			await addItemToCollection(ctx, itemId, collectionId);
		}

		// Trigger screenshot/og image generation for URL items without an image
		if (args.type === 'url' && args.url && !hasImage) {
			await enqueueScreenshot(ctx, { itemId, url: args.url, mode: linkImageMode });
		}

		// Trigger tagging off the item's image (palette always runs, even untagged).
		// URL items still waiting on the worker are tagged once their image lands.
		if (wantsVisualTagging) {
			await enqueueTagging(ctx, internal.taggingActions.tagImageItem, itemId);
		} else if (hasImage) {
			await ctx.scheduler.runAfter(0, internal.taggingActions.repaletteItem, { itemId });
		}

		// Text-mode tagging runs off the article content, independent of the image
		if (wantsTextTagging) {
			await enqueueTagging(ctx, internal.taggingActions.tagTextItem, itemId);
		}

		await scheduleEmbedding(ctx, itemId);

		return itemId;
	}
});

export const update = userMutation({
	args: {
		id: v.id('items'),
		title: v.optional(v.string()),
		description: v.optional(v.string()),
		url: v.optional(v.string()),
		content: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const { id, ...fields } = args;
		const existing = await getOwned(ctx, id);
		if (!existing) throw new ConvexError('item not found');

		// Omitted fields stay as they are; values are trimmed and a blank one
		// clears the field (patching a field to undefined removes it)
		const updates: Partial<Pick<Doc<'items'>, keyof typeof fields | 'normUrl'>> = {};
		for (const key of ['title', 'description', 'url', 'content'] as const) {
			const value = fields[key];
			if (value !== undefined) updates[key] = value.trim() || undefined;
		}
		if (updates.url && !isWebUrl(updates.url)) throw new ConvexError(LINK_ERROR);
		if ('url' in updates) updates.normUrl = updates.url && normalizeUrl(updates.url);

		await patchItem(ctx, existing, { ...updates, dateModified: Date.now() });
		await scheduleEmbedding(ctx, id);
	}
});

export const remove = userMutation({
	args: { id: v.id('items') },
	handler: async (ctx, args) => {
		const item = await getOwned(ctx, args.id);
		if (!item) throw new ConvexError('item not found');

		// Delete all position records for this item
		await deleteAllPositionsForItem(ctx, args.id);
		await deleteItemEmbeddings(ctx, args.id);

		// Delete associated image from R2
		if (item.imageKey) {
			await r2.deleteObject(ctx, item.imageKey);
		}

		await ctx.db.delete(args.id);
	}
});

export const addToCollection = userMutation({
	args: {
		itemId: v.id('items'),
		collectionId: v.id('collections')
	},
	handler: async (ctx, args) => {
		if (!(await getOwned(ctx, args.itemId))) throw new ConvexError('item not found');
		await addItemToCollection(ctx, args.itemId, args.collectionId);
	}
});

export const removeFromCollection = userMutation({
	args: {
		itemId: v.id('items'),
		collectionId: v.id('collections')
	},
	handler: async (ctx, args) => {
		if (!(await getOwned(ctx, args.itemId))) throw new ConvexError('item not found');
		await removeItemFromCollection(ctx, args.itemId, args.collectionId);
	}
});

export const list = userQuery({
	args: {
		sortBy: v.optional(sortModeValidator),
		collectionIds: v.optional(v.array(v.id('collections'))),
		includeUncollected: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		const sortBy = args.sortBy ?? 'dateAddedNewest';
		// Date sorts come straight off an index; title sorts re-sort oldest-first
		const byUser = ctx.db.query('items');
		const query = sortBy.startsWith('dateModified')
			? byUser.withIndex('by_user_dateModified', (q) => q.eq('userId', ctx.userId))
			: byUser.withIndex('by_user_dateAdded', (q) => q.eq('userId', ctx.userId));
		let items = await query.order(sortBy.endsWith('Newest') ? 'desc' : 'asc').collect();
		if (sortBy.startsWith('title')) items.sort(compareItems[sortBy]);

		// Only the picked collections (and uncollected items, if picked); no picks is everything
		const { collectionIds = [], includeUncollected = false } = args;
		if (collectionIds.length > 0 || includeUncollected) {
			const picked = new Set(collectionIds);
			items = items.filter((item) =>
				item.collections.length > 0
					? item.collections.some((c) => picked.has(c))
					: includeUncollected
			);
		}

		return items.map((item) => ({
			...item,
			imageUrl: getImageUrl(item)
		}));
	}
});

export const listByCollection = viewerQuery({
	args: {
		collectionId: v.id('collections'),
		sortBy: v.optional(collectionSortModeValidator)
	},
	handler: async (ctx, args) => {
		const sortBy = args.sortBy ?? 'manual';
		if (!(await getViewable(ctx, args.collectionId))) return [];

		// Position rows come in manual order, which the stable sort keeps for ties
		const positions = await getPositionsByCollection(ctx, args.collectionId);
		const items = await Promise.all(
			positions.map(async ({ itemId, position }) => {
				const item = await ctx.db.get(itemId);
				return item && { ...forViewer(ctx, item), position };
			})
		);
		const members = items.filter((item) => item !== null);
		if (sortBy !== 'manual') members.sort(compareItems[sortBy]);
		return members;
	}
});

export const search = userQuery({
	args: { query: v.string() },
	handler: async (ctx, args) => {
		if (!args.query.trim()) {
			return [];
		}
		const results = await ctx.db
			.query('items')
			.withSearchIndex('search_items', (q) =>
				q.search('searchText', args.query).eq('userId', ctx.userId)
			)
			.take(50);

		return results.map((item) => ({
			...item,
			imageUrl: getImageUrl(item)
		}));
	}
});

// The caller's saved links to this page (same normalizeUrl), newest first, for
// warning before an add saves it again. Image items saved from a page carry its
// URL too, but they aren't the page.
export const findByUrl = userQuery({
	args: { url: v.string() },
	handler: async (ctx, args) => {
		if (!isWebUrl(args.url)) return [];
		const matches = await ctx.db
			.query('items')
			.withIndex('by_user_normUrl', (q) =>
				q.eq('userId', ctx.userId).eq('normUrl', normalizeUrl(args.url))
			)
			.order('desc')
			.take(20);
		return matches
			.filter((item) => item.type === 'url')
			.map(({ _id, title, url, collections, dateAdded }) => ({
				_id,
				title,
				url,
				collections,
				dateAdded
			}));
	}
});

// Search results the collection filter scans before narrowing to members
const COLLECTION_SEARCH_SCAN = 256;

// Search one collection, for anyone who can see it: the owner's search index,
// narrowed to the collection's members
export const searchCollection = viewerQuery({
	args: { collectionId: v.id('collections'), query: v.string() },
	handler: async (ctx, args) => {
		const collection = await getViewable(ctx, args.collectionId);
		if (!collection || !args.query.trim()) return [];
		const results = await ctx.db
			.query('items')
			.withSearchIndex('search_items', (q) =>
				q.search('searchText', args.query).eq('userId', collection.userId)
			)
			.take(COLLECTION_SEARCH_SCAN);
		return results
			.filter((item) => item.collections.includes(collection._id))
			.map((item) => forViewer(ctx, item));
	}
});

// One-shot backfill after buildSearchText's or normalizeUrl's inputs change:
// recomputes every item's searchText and normUrl, a page per transaction.
// Run with `npx convex run items:rebuildSearchText` (add --prod for production)
export const rebuildSearchText = internalMutation({
	args: { cursor: v.optional(v.string()) },
	handler: async (ctx, args) => {
		const { page, isDone, continueCursor } = await ctx.db
			.query('items')
			.paginate({ numItems: 100, cursor: args.cursor ?? null });
		for (const item of page) {
			const searchText = buildSearchText(item);
			const normUrl = item.url ? normalizeUrl(item.url) : undefined;
			if (searchText !== item.searchText || normUrl !== item.normUrl) {
				await ctx.db.patch(item._id, { searchText, normUrl });
			}
		}
		if (!isDone) {
			await ctx.scheduler.runAfter(0, internal.items.rebuildSearchText, {
				cursor: continueCursor
			});
		}
	}
});
