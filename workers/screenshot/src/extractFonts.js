// Runs inside the page via page.evaluate, so it must stay self-contained (no
// imports, no outer-scope references). Plain JS because the worker's tsconfig
// has no DOM lib; the signature lives in extractFonts.d.ts.
//
// Reads the declared font-family of every element that directly owns text in
// the first three screens and returns the most prominent families, weighted by
// characters times font size. Marks one element per family with
// data-recollect-font="<index>" so the worker can ask Chromium for the font
// file's internal name.
export async function extractFonts() {
	const SCAN_DEPTH = innerHeight * 3;
	const MAX_ELEMENTS = 4000;
	const MAX_FAMILIES = 5;
	const MIN_SHARE = 0.03;
	// Whole-word "icon(s)" and known icon-font names, so text faces like
	// "Faculty Glyphic" or "Silicon" stay
	const ICON_FONT =
		/(^|[^a-z])icons?([^a-z]|$)|awesome|material symbols|glyphicons|feather|ionicons|remixicon|phosphor|fontello|icomoon|dashicons|swiper|slick|eicons|lucide/i;

	// Until webfonts load, Chromium reports the fallback it rendered instead
	await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1000))]);

	// Bare generics are what unstyled text (cookie banners, defaults) falls back
	// to. The system-ui/ui-* keywords stay: a page set in the system font chose it.
	const GENERIC = /^(serif|sans-serif|monospace|cursive|fantasy|emoji|math|fangsong)$/i;

	// First declared family, skipping framework metric fallbacks (next/font
	// "X Fallback", Framer "X Placeholder")
	function declaredFamily(stack) {
		for (const part of stack.split(',')) {
			const name = part.trim().replace(/^["']|["']$/g, '');
			if (name && !/ (fallback|placeholder)$/i.test(name)) return name;
		}
		return null;
	}

	const families = new Map();
	let largest = { size: 0, key: null };
	let scanned = 0;
	for (const el of document.body?.getElementsByTagName('*') ?? []) {
		if (scanned >= MAX_ELEMENTS) break;
		if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(el.tagName) || el.closest('svg')) continue;
		let text = '';
		for (const node of el.childNodes) if (node.nodeType === 3) text += node.textContent;
		text = text.trim();
		if (!text) continue;
		const rect = el.getBoundingClientRect();
		// Hidden-by-opacity text still counts: reveal animations start at 0
		if (rect.width === 0 || rect.height === 0 || rect.bottom <= 0 || rect.top >= SCAN_DEPTH)
			continue;
		scanned++;
		const style = getComputedStyle(el);
		if (style.display === 'none') continue;
		const family = declaredFamily(style.fontFamily);
		// Icon fonts render Private Use Area glyphs
		if (!family || GENERIC.test(family) || ICON_FONT.test(family) || /[-]/.test(text)) {
			continue;
		}
		const chars = Math.min(text.length, 2000);
		const size = parseFloat(style.fontSize) || 16;
		const key = family.toLowerCase();
		let entry = families.get(key);
		if (!entry) {
			entry = { family, weight: 0, el, elChars: 0 };
			families.set(key, entry);
		}
		entry.weight += chars * size;
		// The element with the most text is the best sample for the font lookup
		if (chars > entry.elChars) {
			entry.el = el;
			entry.elChars = chars;
		}
		if (size > largest.size) largest = { size, key };
	}

	const total = [...families.values()].reduce((sum, f) => sum + f.weight, 0);
	// The largest text's family stays even when it's a short headline: that's
	// usually the display face
	return [...families.entries()]
		.sort((a, b) => b[1].weight - a[1].weight)
		.filter(([key, f]) => f.weight / total >= MIN_SHARE || key === largest.key)
		.slice(0, MAX_FAMILIES)
		.map(([, f], i) => {
			f.el.setAttribute('data-recollect-font', String(i));
			return f.family;
		});
}
