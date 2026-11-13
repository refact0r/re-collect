// Runs inside the page via page.evaluate, so it must stay self-contained (no
// imports, no outer-scope references). Plain JS because the worker's tsconfig
// has no DOM lib; the signature lives in extractFonts.d.ts.
//
// Reads the declared font-family of every element that directly owns text in
// the first three screens and returns the most prominent families with their
// roles. Marks one element per family with data-recollect-font="<index>" so
// the worker can ask Chromium for the font file's internal name.
export async function extractFonts() {
	const SCAN_DEPTH = innerHeight * 3;
	const MAX_ELEMENTS = 4000;
	const MAX_FAMILIES = 5;
	const MIN_SHARE = 0.03;
	const GENERIC =
		/^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-sans-serif|ui-serif|ui-monospace|ui-rounded|-apple-system|blinkmacsystemfont|emoji|math|fangsong|inherit|initial)$/i;
	const ICON_FONT =
		/icon|awesome|material symbols|glyph|feather|ionicons|remixicon|phosphor|fontello|icomoon|dashicons|swiper|slick|eicons|lucide/i;
	const MONO = /mono|code|courier|consolas|menlo/i;

	await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1000))]);

	const loaded = new Set();
	for (const face of document.fonts) {
		if (face.status === 'loaded') loaded.add(face.family.replace(/^["']|["']$/g, '').toLowerCase());
	}

	// First declared family, skipping framework metric fallbacks (next/font
	// "X Fallback", Framer "X Placeholder")
	function declaredFamily(stack) {
		for (const part of stack.split(',')) {
			const name = part.trim().replace(/^["']|["']$/g, '');
			if (name && !/ (fallback|placeholder)$/i.test(name)) return name;
		}
		return null;
	}

	const runs = [];
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
		if (!family || GENERIC.test(family) || ICON_FONT.test(family) || /[-]/.test(text)) {
			continue;
		}
		runs.push({
			el,
			family,
			chars: Math.min(text.length, 2000),
			size: parseFloat(style.fontSize) || 16,
			heading: /^H[1-6]$/.test(el.tagName),
			mono:
				/^(CODE|PRE|KBD|SAMP)$/.test(el.tagName) || !!el.closest('pre, code') || MONO.test(family),
			prose: !!el.closest('p, li, blockquote, article, td, dd')
		});
	}
	if (!runs.length) return [];

	// Body size: the size carrying the most prose text
	const proseBySize = new Map();
	for (const r of runs) {
		if (r.prose && !r.mono) proseBySize.set(r.size, (proseBySize.get(r.size) ?? 0) + r.chars);
	}
	const bodySize = [...proseBySize].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 16;

	const families = new Map();
	const roleTotals = { heading: new Map(), body: new Map(), mono: new Map() };
	for (const r of runs) {
		const role = r.mono
			? 'mono'
			: r.heading || (r.size >= bodySize * 1.4 && r.chars < 300)
				? 'heading'
				: 'body';
		// Large display text counts for more than its character count
		const weight = r.chars * Math.max(1, r.size / bodySize);
		const key = r.family.toLowerCase();
		let entry = families.get(key);
		if (!entry) {
			entry = { family: r.family, weight: 0, el: r.el, elChars: 0 };
			families.set(key, entry);
		}
		entry.weight += weight;
		// The element with the most text is the best sample for the font lookup
		if (r.chars > entry.elChars) {
			entry.el = r.el;
			entry.elChars = r.chars;
		}
		roleTotals[role].set(key, (roleTotals[role].get(key) ?? 0) + weight);
	}

	const total = [...families.values()].reduce((sum, f) => sum + f.weight, 0);
	const topFor = (role) => [...roleTotals[role]].sort((a, b) => b[1] - a[1])[0]?.[0];
	const roleOwners = { heading: topFor('heading'), body: topFor('body'), mono: topFor('mono') };

	return [...families.entries()]
		.sort((a, b) => b[1].weight - a[1].weight)
		.filter(([key, f]) => f.weight / total >= MIN_SHARE || roleOwners.heading === key)
		.slice(0, MAX_FAMILIES)
		.map(([key, f], i) => {
			f.el.setAttribute('data-recollect-font', String(i));
			return {
				family: f.family,
				roles: ['heading', 'body', 'mono'].filter((role) => roleOwners[role] === key),
				webfont: loaded.has(key)
			};
		});
}
