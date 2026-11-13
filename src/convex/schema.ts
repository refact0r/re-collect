import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

// Ingestion mode validators, shared by every table/mutation that stores them.
// undefined always means the default: 'visual' / 'screenshot'.
export const taggingModeValidator = v.union(
	v.literal('visual'),
	v.literal('text'),
	v.literal('none')
);
export const linkImageModeValidator = v.union(v.literal('screenshot'), v.literal('og'));

// A font read off a URL item's page by the screenshot worker (see lib/fonts.ts)
export const siteFontValidator = v.object({
	family: v.string(), // First declared CSS font-family
	internalName: v.optional(v.string()) // Family name from the font file itself (webfonts only)
});

// Sort mode validators, shared by every table/mutation that stores them.
// Collections additionally support 'manual' (fractional-index ordering).
const sortModes = [
	v.literal('dateAddedNewest'),
	v.literal('dateAddedOldest'),
	v.literal('dateModifiedNewest'),
	v.literal('dateModifiedOldest'),
	v.literal('titleAsc'),
	v.literal('titleDesc')
] as const;
export const sortModeValidator = v.union(...sortModes);
export const collectionSortModeValidator = v.union(v.literal('manual'), ...sortModes);

export default defineSchema({
	// One row per account (see lib/auth.ts, sessions.ts, users.ts)
	users: defineTable({
		username: v.string(), // Lowercase, unique
		passwordHash: v.string(), // PBKDF2, format in lib/auth.ts
		// Password attempts since the last success, for the lockout in sessions.ts
		failedLogins: v.optional(v.number()),
		lastFailedLogin: v.optional(v.number())
	}).index('by_username', ['username']),

	// One per signed-in browser or extension; only the token's hash is stored
	sessions: defineTable({
		userId: v.id('users'),
		tokenHash: v.string(),
		extension: v.optional(v.boolean()) // Minted on /account; a new one replaces it
	})
		.index('by_tokenHash', ['tokenHash'])
		.index('by_user', ['userId']),

	// One-time signup links minted by users:invite
	invites: defineTable({
		codeHash: v.string()
	}).index('by_codeHash', ['codeHash']),

	// R2 keys minted by r2.generateUploadUrl and not yet attached to an item, so
	// items.add only accepts a key its caller uploaded (and only once)
	uploads: defineTable({
		userId: v.id('users'),
		key: v.string()
	}).index('by_key', ['key']),

	items: defineTable({
		userId: v.id('users'),
		type: v.union(v.literal('url'), v.literal('image'), v.literal('text')),
		title: v.optional(v.string()),
		description: v.optional(v.string()), // User notes — never machine-written
		// og:description captured by the screenshot worker; display fallback when
		// there's no AI subject, and a search-token source
		ogDescription: v.optional(v.string()),
		url: v.optional(v.string()),
		content: v.optional(v.string()), // For text items
		imageKey: v.optional(v.string()), // R2 object key for uploaded images
		imageWidth: v.optional(v.number()), // Image dimensions for masonry layout
		imageHeight: v.optional(v.number()),
		// Screenshot generation status for URL items
		screenshotStatus: v.optional(
			v.union(
				v.literal('pending'),
				v.literal('processing'),
				v.literal('completed'),
				v.literal('failed')
			)
		),
		screenshotError: v.optional(v.string()),
		// LLM tagger output
		styles: v.optional(v.array(v.string())),
		subject: v.optional(v.string()),
		aiTags: v.optional(v.array(v.string())),
		// Deterministic palette extracted from pixels (not LLM)
		paletteHex: v.optional(v.array(v.string())),
		// Named-color tokens derived from paletteHex via Lab nearest-neighbor;
		// included in searchText so queries like "blue poster" hit color matches.
		paletteNames: v.optional(v.array(v.string())),
		// Fonts the page uses, most prominent first (URL items, screenshot captures
		// only); name variants go into searchText
		fonts: v.optional(v.array(siteFontValidator)),
		// Tagging status tracking
		taggingStatus: v.optional(
			v.union(
				v.literal('pending'),
				v.literal('processing'),
				v.literal('completed'),
				v.literal('failed')
			)
		),
		taggingError: v.optional(v.string()),
		taggingModelVersion: v.optional(v.string()),
		// Ingestion prefs snapshotted from the first collection at add time
		taggingMode: v.optional(taggingModeValidator),
		linkImageMode: v.optional(linkImageModeValidator), // URL items only
		searchText: v.optional(v.string()), // Derived full-text search field, see lib/searchText.ts
		collections: v.array(v.id('collections')),
		dateAdded: v.number(),
		dateModified: v.number()
	})
		.index('by_user_dateAdded', ['userId', 'dateAdded'])
		.index('by_user_dateModified', ['userId', 'dateModified'])
		.searchIndex('search_items', {
			searchField: 'searchText',
			filterFields: ['userId']
		}),

	collections: defineTable({
		userId: v.id('users'),
		name: v.string(),
		dateCreated: v.number(),
		position: v.optional(v.string()), // Lexicographical fractional index for manual ordering
		itemCount: v.optional(v.number()), // Denormalized count of itemCollectionPositions rows (backfilled by migration 011)
		sortMode: v.optional(collectionSortModeValidator), // Defaults to 'manual'
		viewMode: v.optional(v.union(v.literal('grid'), v.literal('list'))), // Defaults to 'grid'
		columnOffset: v.optional(v.number()), // Added to the width-derived grid column count
		showTitles: v.optional(v.boolean()), // Defaults to false
		// Anyone with the link can view it (read-only); defaults to private
		shared: v.optional(v.boolean()),
		// Ingestion defaults applied to items added into this collection
		taggingMode: v.optional(taggingModeValidator),
		linkImageMode: v.optional(linkImageModeValidator)
	}).index('by_user_position', ['userId', 'position']),

	// View preferences for non-collection pages (home, search)
	viewPreferences: defineTable({
		userId: v.id('users'),
		key: v.string(), // "home", "search"
		sortMode: v.optional(sortModeValidator),
		viewMode: v.optional(v.union(v.literal('grid'), v.literal('list'))),
		columnOffset: v.optional(v.number()),
		showTitles: v.optional(v.boolean()),
		filterCollectionIds: v.optional(v.array(v.id('collections'))),
		includeUncollected: v.optional(v.boolean()),
		// Ingestion defaults for collection-less adds (stored on the "home" row)
		taggingMode: v.optional(taggingModeValidator),
		linkImageMode: v.optional(linkImageModeValidator)
	}).index('by_user_key', ['userId', 'key']),

	// Junction table for per-collection item ordering. Unscoped: rows are only
	// reached through an owned item or collection, and both sides share an owner.
	itemCollectionPositions: defineTable({
		itemId: v.id('items'),
		collectionId: v.id('collections'),
		position: v.string(), // Lexicographical: "a", "aM", "b", etc.
		dateAdded: v.number()
	})
		.index('by_collection', ['collectionId', 'position'])
		.index('by_collection_dateAdded', ['collectionId', 'dateAdded'])
		.index('by_item', ['itemId'])
		.index('by_item_and_collection', ['itemId', 'collectionId'])
});
