// Fonts read off a URL item's page by the screenshot worker. Stored raw (CSS
// family + the font file's internal name), so naming tweaks here apply to
// existing items without re-crawling: the display name and search terms are
// derived on read.
import type { Doc } from '../_generated/dataModel';

export type SiteFont = NonNullable<Doc<'items'>['fonts']>[number];

const MAX_FONTS = 5;
const MAX_NAME_LENGTH = 100;

// Narrow the worker's JSON, dropping malformed entries and fonts with no usable
// name (hashed families) instead of failing the capture. Families that differ
// only by weight ("Editor-Regular" and "Editor-Bold" declared separately)
// collapse into the first one.
export function parseSiteFonts(raw: unknown): SiteFont[] | undefined {
	if (!Array.isArray(raw)) return undefined;
	const fonts = new Map<string, SiteFont>();
	for (const entry of raw) {
		if (typeof entry !== 'object' || entry === null) continue;
		const { family, internalName } = entry as Record<string, unknown>;
		if (typeof family !== 'string' || !family.trim()) continue;
		const font: SiteFont = {
			family: family.trim().slice(0, MAX_NAME_LENGTH),
			...(typeof internalName === 'string' &&
				internalName.trim() && { internalName: internalName.trim().slice(0, MAX_NAME_LENGTH) })
		};
		const [name] = fontNames(font);
		if (!name) continue;
		const key = fontSearchKey(name);
		if (!fonts.has(key) && fonts.size < MAX_FONTS) fonts.set(key, font);
	}
	return [...fonts.values()];
}

// Weight/style/format words that name a cut rather than the family, stripped
// from the end only ("Black Han Sans" keeps its "Black"; "Times New Roman" its "Roman")
const STYLE_SUFFIX =
	/\s+(thin|hairline|extra ?light|ultra ?light|light|book|buch|regular|normal|(?<!new )roman|medium|semi ?bold|smbld|demi ?bold|bold|halbfett|extra ?bold|ultra ?bold|heavy|black|italic|oblique|variable|var|vf|web|webfont)$/i;

// Internal names that aren't names: Klim's fonts report their copyright line,
// and font-shop kits often report nothing usable
const JUNK = /copyright|trademark|all rights|reserved|\.(com|net|org)\b/i;

function cleanName(raw: string): string | undefined {
	let name = raw.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
	// Split run-together CamelCase ("HelveticaNeue"), but only when the name has
	// no spaces at all, so "JetBrains Mono" stays intact
	if (!name.includes(' ')) name = name.replace(/([a-z])([A-Z])/g, '$1 $2');
	let stripped = name;
	while (STYLE_SUFFIX.test(stripped)) stripped = stripped.replace(STYLE_SUFFIX, '');
	name = stripped || name;
	if (
		name.length < 2 ||
		JUNK.test(name) ||
		/^(?=.*\d)[0-9a-f]{6,}$/i.test(name.replace(/ /g, ''))
	) {
		return undefined;
	}
	// Title-case all-lowercase words ("denim") and shouty names ("SOEHNE IKON"),
	// keeping short all-caps prefixes like GT, ABC, PP
	const shouty = name === name.toUpperCase();
	return name
		.split(' ')
		.map((word) =>
			word === word.toLowerCase() || (shouty && word.length > 3)
				? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
				: word
		)
		.join(' ');
}

// Candidate names, best first: the font file's own name, then the CSS family
function fontNames(font: SiteFont): string[] {
	return [font.internalName, font.family]
		.map((n) => (n ? cleanName(n) : undefined))
		.filter((n): n is string => !!n);
}

export function fontDisplayName(font: SiteFont): string {
	return fontNames(font)[0] ?? font.family;
}

const stripAccents = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

// One-word key that matches however the name was spaced or cased: "GT America
// Mono" -> "gtamericamono". German umlauts also get their "oe" spelling, so
// "Söhne" is findable as söhne, sohne and soehne.
export function fontSearchKey(name: string): string {
	return stripAccents(name)
		.toLowerCase()
		.replace(/[^a-z0-9]/g, '');
}

// Search query matching only items that use this font. Convex treats the last
// query term as a prefix, so a bare "inter" would also hit "interface"; the
// "font" prefix keeps it to font tokens.
export function fontQuery(font: SiteFont): string {
	return `font${fontSearchKey(fontDisplayName(font))}`;
}

export function fontSearchTerms(fonts: SiteFont[] | undefined): string[] {
	// Keyed lowercased: search is case-insensitive, so "Inter" and "inter" are one term
	const terms = new Map<string, string>();
	const add = (term: string) => {
		if (term && !terms.has(term.toLowerCase())) terms.set(term.toLowerCase(), term);
	};
	for (const font of fonts ?? []) {
		const names = fontNames(font);
		if (!names.length) continue;
		add(fontQuery(font));
		for (const name of names) {
			add(name);
			add(stripAccents(name));
			add(fontSearchKey(name));
			add(
				fontSearchKey(
					name
						.replace(/\u00e4/g, 'ae')
						.replace(/\u00f6/g, 'oe')
						.replace(/\u00fc/g, 'ue')
				)
			);
		}
	}
	return [...terms.values()];
}
