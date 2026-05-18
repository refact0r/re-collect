// Build the combined full-text-search string for an item.
// Includes user-entered fields (title/description/url) and AI-tagging output
// (kind/subject/paletteDescription/styles/aiTags). Must be called on any write
// that changes one of these fields. paletteHex is intentionally omitted —
// hex codes aren't useful as search tokens.
export function buildSearchText(fields: {
	title?: string;
	description?: string;
	url?: string;
	kind?: string;
	styles?: string[];
	aiTags?: string[];
	subject?: string;
	paletteDescription?: string;
}): string {
	const kindLabel = fields.kind?.replace(/_/g, ' ');
	return [
		fields.title,
		fields.description,
		fields.url,
		kindLabel,
		fields.subject,
		fields.paletteDescription,
		fields.styles?.join(' '),
		fields.aiTags?.join(' ')
	]
		.filter(Boolean)
		.join(' ');
}
