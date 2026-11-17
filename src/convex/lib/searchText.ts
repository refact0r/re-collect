import type { Doc } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { fontSearchTerms } from './fonts';

// Text notes can be long; the search index only needs enough of one to find it,
// and the copy here mustn't push the document toward its 1 MiB limit
const MAX_CONTENT_CHARS = 10_000;

type SearchFields = Pick<
	Doc<'items'>,
	| 'title'
	| 'description'
	| 'ogDescription'
	| 'url'
	| 'content'
	| 'subject'
	| 'styles'
	| 'aiTags'
	| 'paletteNames'
	| 'fonts'
>;

// An item's full-text search string. Pass the whole item as it will be stored,
// e.g. `buildSearchText({ ...item, ...patch })`. paletteHex is left out: hex
// codes aren't useful search tokens, its paletteNames are.
export function buildSearchText(fields: Partial<SearchFields>): string {
	return [
		fields.title,
		fields.description,
		fields.ogDescription,
		fields.url,
		fields.content?.slice(0, MAX_CONTENT_CHARS),
		fields.subject,
		fields.styles?.join(' '),
		fields.aiTags?.join(' '),
		fields.paletteNames?.join(' '),
		fontSearchTerms(fields.fonts).join(' ')
	]
		.filter(Boolean)
		.join(' ');
}

// Patches an item and rebuilds its searchText from the result, so no write can
// leave it stale. A field patched to undefined is cleared.
export async function patchItem(
	ctx: MutationCtx,
	item: Doc<'items'>,
	fields: Partial<Omit<Doc<'items'>, '_id' | '_creationTime'>>
) {
	await ctx.db.patch(item._id, { ...fields, searchText: buildSearchText({ ...item, ...fields }) });
}
