import { fontSearchTerms, type SiteFont } from './fonts';

// Build the combined full-text-search string for an item.
// Includes user-entered fields (title/description/url), the captured
// og:description, AI-tagging output (subject/styles/aiTags), palette-derived
// color names, and the page's font names. Must be called on any write that
// changes one of these fields. paletteHex is intentionally omitted — hex codes
// aren't useful as search tokens, but paletteNames is.
export function buildSearchText(fields: {
	title?: string;
	description?: string;
	ogDescription?: string;
	url?: string;
	styles?: string[];
	aiTags?: string[];
	subject?: string;
	paletteNames?: string[];
	fonts?: SiteFont[];
}): string {
	return [
		fields.title,
		fields.description,
		fields.ogDescription,
		fields.url,
		fields.subject,
		fields.styles?.join(' '),
		fields.aiTags?.join(' '),
		fields.paletteNames?.join(' '),
		fontSearchTerms(fields.fonts).join(' ')
	]
		.filter(Boolean)
		.join(' ');
}
