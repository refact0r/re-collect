// Browser-side design-token extractor. Self-contained: the runner passes this
// file's source to page.evaluate, so nothing here may close over outer scope.
// Returns raw-ish aggregates; run.mjs does nothing but time and save them.
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- called via page.evaluate
async function extractTokens() {
	const t0 = performance.now();
	const VW = innerWidth;
	const VH = innerHeight;
	const SCAN_DEPTH = VH * 3; // typography/layout: first three screens
	const MAX_ELEMENTS = 4000;

	await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 3000))]);

	// ---------- helpers ----------
	const cvs = document.createElement('canvas');
	cvs.width = cvs.height = 1;
	const ctx = cvs.getContext('2d', { willReadFrequently: true });
	const colorCache = new Map();
	// Any CSS color (rgb, oklch, color(), named) -> { hex, a } via a 1px paint
	function toHex(value) {
		if (!value || value === 'transparent' || value === 'none') return null;
		if (colorCache.has(value)) return colorCache.get(value);
		ctx.clearRect(0, 0, 1, 1);
		ctx.fillStyle = '#00000000';
		ctx.fillStyle = value;
		ctx.fillRect(0, 0, 1, 1);
		const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
		const out =
			a === 0
				? null
				: {
						hex: '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join(''),
						a: +(a / 255).toFixed(2),
						r,
						g,
						b
					};
		colorCache.set(value, out);
		return out;
	}
	function chroma(c) {
		const max = Math.max(c.r, c.g, c.b);
		const min = Math.min(c.r, c.g, c.b);
		return (max - min) / 255;
	}
	function lum(c) {
		return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
	}
	const bump = (map, key, w = 1) => map.set(key, (map.get(key) || 0) + w);
	const top = (map, n, total) => {
		const sum = total ?? [...map.values()].reduce((a, b) => a + b, 0);
		return [...map.entries()]
			.sort((a, b) => b[1] - a[1])
			.slice(0, n)
			.map(([k, w]) => ({ value: k, share: sum ? +(w / sum).toFixed(3) : 0 }));
	};
	const px = (v) => parseFloat(v) || 0;

	const ICON_FONT = /icon|awesome|material symbols|material-symbols|glyph|feather|ionicons|remixicon|phosphor|fontello|icomoon|dashicons|swiper-icons|slick|eicons|lucide/i;
	function families(stack) {
		return stack
			.split(',')
			.map((s) => s.trim().replace(/^["']|["']$/g, ''))
			.filter(Boolean);
	}
	// next/font "__Inter_a1b2c3", Framer "Inter Display Placeholder", weights in names...
	function cleanFamily(name) {
		return name
			.replace(/^__/, '')
			.replace(/_[0-9a-f]{5,8}$/i, '')
			.replace(/_Fallback(_[0-9a-f]+)?$/i, ' Fallback')
			.replace(/_/g, ' ')
			.replace(/\s+/g, ' ')
			.trim();
	}

	// Loaded web fonts, keyed by lowercase family
	const fontFaces = [];
	const webfontFamilies = new Set();
	for (const f of document.fonts) {
		const fam = f.family.replace(/^["']|["']$/g, '');
		fontFaces.push({ family: fam, weight: f.weight, style: f.style, status: f.status });
		if (f.status === 'loaded') webfontFamilies.add(fam.toLowerCase());
	}
	// First declared family (what the designer chose); skip framework fallbacks
	function usedFamily(stack) {
		const list = families(stack).filter((f) => !/ (Fallback|Placeholder)$/i.test(f));
		const fam = list[0] || 'unknown';
		return { family: fam, webfont: webfontFamilies.has(fam.toLowerCase()) };
	}

	const isVisible = (el, cs, r) =>
		r.width > 0 &&
		r.height > 0 &&
		cs.visibility !== 'hidden' &&
		cs.display !== 'none' &&
		+cs.opacity > 0.05 &&
		r.bottom > 0 &&
		r.top < SCAN_DEPTH;

	// ---------- walk elements ----------
	const textRuns = []; // one per element that directly owns text
	const radii = new Map();
	let boxedCount = 0;
	let sharpCount = 0;
	let pillCount = 0;
	const shadows = new Map();
	const spacing = new Map();
	const containers = new Map();
	const durations = new Map();
	const easings = new Map();
	const borderColors = new Map();
	const accentBg = new Map();
	const linkColors = new Map();
	let animated = 0;
	let gridCount = 0;
	let flexCount = 0;
	let scanned = 0;

	const all = document.body ? document.body.getElementsByTagName('*') : [];
	for (const el of all) {
		if (scanned >= MAX_ELEMENTS) break;
		const tag = el.tagName.toLowerCase();
		if (tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'svg' || el.closest('svg')) continue;
		const r = el.getBoundingClientRect();
		if (r.top >= SCAN_DEPTH) continue;
		const cs = getComputedStyle(el);
		if (r.width === 0 || r.height === 0 || r.bottom <= 0) continue;
		const visible = isVisible(el, cs, r);
		scanned++;

		// direct text
		let chars = 0;
		for (const n of el.childNodes) if (n.nodeType === 3) chars += n.textContent.trim().length;
		if (chars > 0) {
			const text = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
			const pua = /[-]/.test(text); // icon-font glyphs
			textRuns.push({
				tag,
				chars: Math.min(chars, 2000),
				size: px(cs.fontSize),
				weight: cs.fontWeight,
				lineHeight: cs.lineHeight,
				letterSpacing: cs.letterSpacing,
				transform: cs.textTransform,
				stack: cs.fontFamily,
				color: cs.color,
				pua,
				inUi: !!el.closest('button, nav, [role="button"], [role="navigation"], input, select, label, header a, footer'),
				inProse: !!el.closest('p, li, blockquote, article, td, dd'),
				mono: /^(code|pre|kbd|samp|tt)$/.test(tag) || !!el.closest('pre, code'),
				top: r.top,
				hidden: !visible,
				el
			});
		}

		if (!visible) continue;
		const bg = toHex(cs.backgroundColor);
		const bw = px(cs.borderTopWidth) + px(cs.borderLeftWidth);
		const hasShadow = cs.boxShadow !== 'none';
		const area = r.width * r.height;
		if ((bg && bg.a > 0.2) || bw > 0 || hasShadow) {
			if (area > 200 && area < VW * VH * 0.8) {
				boxedCount++;
				const rad = px(cs.borderTopLeftRadius);
				if (rad === 0) sharpCount++;
				else if (rad >= Math.min(r.width, r.height) / 2 - 1) pillCount++;
				else bump(radii, Math.round(rad));
			}
			if (hasShadow && !/^(rgba\(0, 0, 0, 0\) [^,]*(, )?)+$/.test(cs.boxShadow)) bump(shadows, cs.boxShadow);
			if (bw > 0) {
				const bc = toHex(cs.borderTopColor);
				if (bc) bump(borderColors, bc.hex);
			}
		}
		// accent candidates: chromatic fills on interactive elements
		const interactive = tag === 'a' || tag === 'button' || el.getAttribute('role') === 'button';
		if (interactive && bg && bg.a > 0.5 && chroma(bg) > 0.2) bump(accentBg, bg.hex, area);
		if (tag === 'a') {
			const c = toHex(cs.color);
			if (c) bump(linkColors, c.hex, chars || 1);
		}

		for (const v of [cs.paddingTop, cs.paddingLeft, cs.rowGap, cs.columnGap, cs.marginTop]) {
			const n = Math.round(px(v));
			if (n > 0 && n <= 256) bump(spacing, n);
		}
		if (cs.display.includes('grid')) gridCount++;
		if (cs.display.includes('flex')) flexCount++;

		// centered content containers
		const lm = r.left;
		const rm = VW - r.right;
		if (r.width >= 480 && r.width <= VW - 40 && Math.abs(lm - rm) <= 2 && r.height > 120) {
			bump(containers, Math.round(r.width), r.height);
		}

		if (cs.transitionDuration && cs.transitionDuration !== '0s') {
			const ds = cs.transitionDuration.split(',');
			const ps = cs.transitionProperty.split(',');
			const es = cs.transitionTimingFunction.split(/,(?![^(]*\))/);
			ds.forEach((d, i) => {
				const ms = Math.round(parseFloat(d) * (d.trim().endsWith('ms') ? 1 : 1000));
				if (ms > 0) {
					bump(durations, ms);
					bump(easings, (es[i] || es[0]).trim());
				}
			});
			void ps;
		}
		if (cs.animationName && cs.animationName !== 'none') animated++;
	}

	// ---------- typography ----------
	const runs = textRuns.filter((t) => !t.pua && !ICON_FONT.test(t.stack));
	const iconFontRuns = textRuns.length - runs.length;
	const bySize = new Map();
	for (const t of runs) bump(bySize, t.size, t.chars);
	// body size: most text in prose context, else overall
	const proseSizes = new Map();
	for (const t of runs) if (t.inProse && !t.mono) bump(proseSizes, t.size, t.chars);
	const bodySize = +(top(proseSizes.size ? proseSizes : bySize, 1)[0]?.value ?? 16);

	const famStats = new Map();
	const roleOf = (t) => {
		if (t.mono || /mono|code|courier|consolas|menlo/i.test(t.stack)) return 'mono';
		if (/^h[1-6]$/.test(t.tag) || (t.size >= bodySize * 1.4 && t.chars < 300)) return 'heading';
		if (t.inUi && !t.inProse) return 'ui';
		return 'body';
	};
	for (const t of runs) {
		const used = usedFamily(t.stack);
		const name = cleanFamily(used.family);
		const role = roleOf(t);
		t.role = role;
		t.family = name;
		if (!famStats.has(name))
			famStats.set(name, { family: name, webfont: used.webfont, chars: 0, roles: {}, weights: new Set(), stack: t.stack });
		const s = famStats.get(name);
		s.chars += t.chars;
		s.roles[role] = (s.roles[role] || 0) + t.chars;
		s.weights.add(t.weight);
		if (!s.el || (s.el.hidden && !t.hidden)) s.el = t;
	}
	const hiddenShare = runs.reduce((a, t) => a + (t.hidden ? t.chars : 0), 0);
	const totalChars = runs.reduce((a, t) => a + t.chars, 0);
	const fonts = [...famStats.values()]
		.sort((a, b) => b.chars - a.chars)
		.slice(0, 6)
		.map((s, i) => {
			s.el.el.setAttribute('data-dt-font', String(i));
			return s;
		})
		.map((s) => ({
			family: s.family,
			webfont: s.webfont,
			share: +(s.chars / totalChars).toFixed(3),
			roles: Object.fromEntries(Object.entries(s.roles).map(([k, v]) => [k, +(v / s.chars).toFixed(2)])),
			weights: [...s.weights].sort(),
			stack: s.stack
		}));
	const primaryFor = (role) => {
		const m = new Map();
		for (const t of runs) if (t.role === role) bump(m, t.family, t.chars * (role === 'heading' ? t.size : 1));
		return top(m, 1)[0]?.value ?? null;
	};

	const styleOf = (t) => ({
		family: t.family,
		size: t.size,
		weight: t.weight,
		lineHeight: t.lineHeight === 'normal' ? 'normal' : +(px(t.lineHeight) / t.size).toFixed(2),
		letterSpacing: t.letterSpacing === 'normal' ? 0 : +(px(t.letterSpacing) / t.size).toFixed(3),
		transform: t.transform !== 'none' ? t.transform : undefined
	});
	const typeScale = {};
	for (const h of ['h1', 'h2', 'h3']) {
		const t = runs.find((x) => x.tag === h);
		if (t) typeScale[h] = styleOf(t);
	}
	// "display": largest text on the page (often a div, not an h1)
	const display = [...runs].filter((t) => t.chars >= 3).sort((a, b) => b.size - a.size)[0];
	if (display) typeScale.display = styleOf(display);
	const bodyRun = runs.filter((t) => t.size === bodySize && t.role === 'body').sort((a, b) => b.chars - a.chars)[0];
	if (bodyRun) typeScale.body = styleOf(bodyRun);
	const smallRun = runs
		.filter((t) => t.size < bodySize && t.size >= 9)
		.sort((a, b) => b.chars - a.chars)[0];
	if (smallRun) typeScale.small = styleOf(smallRun);
	const sizes = top(bySize, 10).map((s) => ({ px: +s.value, share: s.share }));

	// ---------- color ----------
	// Area-weighted background: sample a grid over the viewport, take the
	// topmost opaque background (or media) under each point
	const bgArea = new Map();
	let mediaPts = 0;
	let canvasPts = 0;
	let pts = 0;
	const CMP = /cookie|consent|gdpr|onetrust|cookiebot|didomi|usercentrics|cmp-|qc-cmp|truste|termly|sp_message|fc-consent/i;
	let cmpHits = 0;
	const rootBg = toHex(getComputedStyle(document.body).backgroundColor) ||
		toHex(getComputedStyle(document.documentElement).backgroundColor) || { hex: '#ffffff', a: 1 };
	for (let y = 10; y < VH; y += VH / 24) {
		for (let x = 10; x < VW; x += VW / 36) {
			pts++;
			let el = document.elementFromPoint(x, y);
			if (!el) continue;
			let hitCmp = false;
			for (let p = el; p && p !== document.body; p = p.parentElement) {
				if (CMP.test((p.id || '') + ' ' + (typeof p.className === 'string' ? p.className : ''))) {
					hitCmp = true;
					break;
				}
			}
			if (hitCmp) cmpHits++;
			const t = el.tagName.toLowerCase();
			if (t === 'img' || t === 'video' || t === 'picture' || t === 'iframe') {
				mediaPts++;
				continue;
			}
			if (t === 'canvas') {
				canvasPts++;
				continue;
			}
			let found = null;
			for (let p = el; p; p = p.parentElement) {
				const cs = getComputedStyle(p);
				if (cs.backgroundImage !== 'none' && /url\(/.test(cs.backgroundImage)) {
					found = 'media';
					break;
				}
				const c = toHex(cs.backgroundColor);
				if (c && c.a > 0.5) {
					found = c.hex;
					break;
				}
			}
			if (found === 'media') mediaPts++;
			else bump(bgArea, found ?? rootBg.hex);
		}
	}
	const textColors = new Map();
	for (const t of runs) {
		const c = toHex(t.color);
		if (c) bump(textColors, c.hex, t.chars);
	}
	const headingColors = new Map();
	for (const t of runs) if (t.role === 'heading') {
		const c = toHex(t.color);
		if (c) bump(headingColors, c.hex, t.chars);
	}
	// accent: chromatic colors from button fills, links, chromatic text, borders
	const accent = new Map();
	const addChromatic = (map, w) => {
		for (const [hex, n] of map) {
			if (hex === '#0000ee' || hex === '#551a8b') continue;
			const c = toHex(hex);
			if (c && chroma(c) > 0.25) bump(accent, hex, n * w);
		}
	};
	const accentBgNorm = new Map([...accentBg].map(([k, v]) => [k, Math.sqrt(v)]));
	addChromatic(accentBgNorm, 3);
	addChromatic(linkColors, 1);
	addChromatic(textColors, 0.5);
	addChromatic(borderColors, 0.5);
	addChromatic(bgArea, 2);

	// ---------- stylesheets: custom properties, dark mode, @font-face ----------
	let sheetsTotal = 0;
	let sheetsBlocked = 0;
	let darkRules = 0;
	let reducedMotionRules = 0;
	let keyframes = 0;
	const rootVarNames = new Set();
	const fontFaceSrcs = [];
	let twV3 = false;
	const walkRules = (rules) => {
		for (const rule of rules) {
			if (rule instanceof CSSMediaRule) {
				if (/prefers-color-scheme:\s*dark/.test(rule.conditionText || rule.media.mediaText)) darkRules += rule.cssRules.length;
				if (/prefers-reduced-motion/.test(rule.conditionText || rule.media.mediaText)) reducedMotionRules++;
				walkRules(rule.cssRules);
			} else if (rule instanceof CSSStyleRule) {
				const sel = rule.selectorText || '';
				if (/(^|,)\s*(:root|html|:host)\b/.test(sel) || /^\s*\[data-theme|^\s*\.(dark|light)\b/.test(sel)) {
					for (const p of rule.style) if (p.startsWith('--')) rootVarNames.add(p);
				}
				if (!twV3 && /\*/.test(sel) && rule.style.getPropertyValue('--tw-ring-offset-width')) twV3 = true;
				if (rule.cssRules?.length) walkRules(rule.cssRules); // nesting
			} else if (rule instanceof CSSFontFaceRule) {
				fontFaceSrcs.push({
					family: rule.style.getPropertyValue('font-family').replace(/["']/g, '').trim(),
					src: (rule.style.getPropertyValue('src').match(/url\(["']?([^"')]+)/) || [])[1]
				});
			} else if (rule instanceof CSSKeyframesRule) {
				keyframes++;
			} else if (rule.cssRules) {
				walkRules(rule.cssRules); // @layer, @supports, @container
			}
		}
	};
	for (const sheet of document.styleSheets) {
		sheetsTotal++;
		try {
			walkRules(sheet.cssRules);
		} catch {
			sheetsBlocked++;
		}
	}
	const rootCs = getComputedStyle(document.documentElement);
	const vars = { color: {}, font: {}, length: {}, other: 0 };
	for (const name of rootVarNames) {
		const val = rootCs.getPropertyValue(name).trim();
		if (!val) continue;
		if (/^(#|rgb|hsl|oklch|oklab|lab|lch|color\()/.test(val)) {
			const c = toHex(val);
			if (c) vars.color[name] = c.hex + (c.a < 1 ? `/${c.a}` : '');
		} else if (/font|family|typeface/.test(name) && /[a-z]/i.test(val) && !/^\d/.test(val)) vars.font[name] = val;
		else if (/^-?[\d.]+(px|rem|em)$/.test(val)) vars.length[name] = val;
		else vars.other++;
	}

	// ---------- font sources ----------
	const fontUrls = performance
		.getEntriesByType('resource')
		.map((e) => e.name)
		.filter((u) => /\.(woff2?|ttf|otf|eot)(\?|#|$)/i.test(u) || /fonts\.gstatic|use\.typekit|fonts\.bunny/.test(u));
	const providers = new Set();
	const providerOf = (u) => {
		if (/fonts\.(googleapis|gstatic)\.com/.test(u)) return 'Google Fonts';
		if (/typekit\.net|use\.adobe/.test(u)) return 'Adobe Fonts';
		if (/fonts\.bunny\.net/.test(u)) return 'Bunny Fonts';
		if (/fontshare\.com/.test(u)) return 'Fontshare';
		if (/cloud\.typography\.com/.test(u)) return 'Hoefler&Co Cloud.typography';
		if (/fonts\.net|fonts\.com/.test(u)) return 'Monotype Fonts.com';
		if (/framerusercontent\.com/.test(u)) return 'Framer-hosted';
		if (/website-files\.com|webflow/.test(u)) return 'Webflow-hosted';
		if (/fontawesome|kit\.fontawesome/.test(u)) return 'Font Awesome';
		return 'self-hosted';
	};
	for (const u of fontUrls) providers.add(providerOf(u));
	const links = [...document.querySelectorAll('link[href], script[src]')].map((l) => l.href || l.src);
	const googleFamilies = links
		.filter((h) => /fonts\.googleapis\.com\/css/.test(h))
		.flatMap((h) => new URL(h).searchParams.getAll('family').flatMap((f) => f.split('|')).map((f) => f.split(':')[0].replace(/\+/g, ' ')));
	const typekitKits = links.map((h) => (h.match(/use\.typekit\.net\/([a-z0-9]+)\.(css|js)/) || [])[1]).filter(Boolean);
	if (googleFamilies.length) providers.add('Google Fonts');
	if (typekitKits.length) providers.add('Adobe Fonts');
	const fontFiles = [...new Set(fontUrls.map((u) => decodeURIComponent(u.split(/[?#]/)[0].split('/').pop())))].slice(0, 12);

	// ---------- tech fingerprint ----------
	const w = window;
	const html = document.documentElement;
	const has = (sel) => !!document.querySelector(sel);
	const generator = document.querySelector('meta[name="generator"]')?.content || null;
	const scripts = [...document.scripts].map((s) => s.src).join(' ');
	const tech = [];
	const t = (cond, name) => cond && tech.push(name);
	t(!!w.__NEXT_DATA__ || has('#__next') || /\/_next\//.test(scripts), 'Next.js');
	t(!!w.__NUXT__ || has('#__nuxt'), 'Nuxt');
	t(has('astro-island') || /astro/i.test(generator || ''), 'Astro');
	t(!!w.__sveltekit_dev || /__sveltekit|\/_app\/immutable\//.test(scripts + html.innerHTML.slice(0, 50000)), 'SvelteKit');
	t(has('#___gatsby'), 'Gatsby');
	t(has('[data-framer-hydrate-v2], [data-framer-component-type]') || /framer/i.test(generator || ''), 'Framer');
	t(!!html.getAttribute('data-wf-site') || /webflow/i.test(generator || ''), 'Webflow');
	t(/wp-content|wp-includes/.test(scripts) || /wordpress/i.test(generator || ''), 'WordPress');
	t(/squarespace/i.test(scripts + (generator || '')), 'Squarespace');
	t(/cdn\.shopify\.com/.test(scripts), 'Shopify');
	t(/wix/i.test(generator || '') || /static\.parastorage\.com/.test(scripts), 'Wix');
	t(/ghost/i.test(generator || ''), 'Ghost');
	t(/cargo/i.test(scripts) || has('[data-cargo]'), 'Cargo');
	t(/readymag/i.test(scripts), 'Readymag');
	t(/hugo/i.test(generator || ''), 'Hugo');
	t(/tumblr/i.test(scripts + location.host), 'Tumblr');
	t(/substack/i.test(scripts), 'Substack');
	t(!!w.__remixContext || !!w.__reactRouterContext, 'Remix/React Router');
	t(twV3 || Object.keys(vars.color).some((k) => k.startsWith('--color-') ) && [...rootVarNames].some((k) => k.startsWith('--tw-') || k === '--spacing' || k.startsWith('--text-')), 'Tailwind');
	const reactRoot = [...document.querySelectorAll('body *')].slice(0, 300).some((e) => Object.keys(e).some((k) => k.startsWith('__react')));
	t(reactRoot, 'React');
	t(!!w.__VUE__ || has('[data-v-app]'), 'Vue');
	// motion / 3D libraries
	t(!!w.gsap, 'GSAP');
	t(!!w.ScrollTrigger, 'ScrollTrigger');
	t(!!w.Lenis || !!w.lenis || html.classList.contains('lenis'), 'Lenis');
	t(has('[data-scroll-container]') || html.classList.contains('has-scroll-smooth'), 'Locomotive Scroll');
	t(!!w.__THREE__ || !!w.THREE, 'Three.js');
	t(has('spline-viewer') || /splinetool/.test(scripts), 'Spline');
	t(!!w.lottie || has('lottie-player, dotlottie-player'), 'Lottie');
	t(!!w.Swiper || has('.swiper'), 'Swiper');
	t(!!w.barba, 'Barba');

	// ---------- motion summary ----------
	let runningAnimations = 0;
	try {
		runningAnimations = document.getAnimations().length;
	} catch {
		// unsupported
	}

	const metaThemeColor = document.querySelector('meta[name="theme-color"]')?.content || null;
	const metaColorScheme = document.querySelector('meta[name="color-scheme"]')?.content || null;

	return {
		ms: Math.round(performance.now() - t0),
		scanned,
		fonts,
		roles: {
			heading: primaryFor('heading'),
			body: primaryFor('body'),
			ui: primaryFor('ui'),
			mono: primaryFor('mono')
		},
		typeScale,
		sizes,
		iconFontRuns,
		hiddenTextShare: +(hiddenShare / (totalChars || 1)).toFixed(2),
		fontSources: {
			providers: [...providers],
			googleFamilies: [...new Set(googleFamilies)],
			typekitKits,
			files: fontFiles,
			faces: [...new Set(fontFaces.filter((f) => f.status === 'loaded').map((f) => `${f.family} ${f.weight}${f.style !== 'normal' ? ' ' + f.style : ''}`))].slice(0, 20),
			fontFaceRules: fontFaceSrcs.length
		},
		color: {
			background: top(bgArea, 5, pts),
			mediaCoverage: +(mediaPts / pts).toFixed(2),
			canvasCoverage: +(canvasPts / pts).toFixed(2),
			text: top(textColors, 4),
			heading: top(headingColors, 2),
			accent: top(accent, 4),
			rootBg: rootBg.hex,
			isDark: lum(toHex(top(bgArea, 1, pts)[0]?.value || rootBg.hex)) < 0.35,
			metaThemeColor,
			metaColorScheme,
			colorSchemeProp: rootCs.colorScheme
		},
		vars: {
			count: rootVarNames.size,
			colorCount: Object.keys(vars.color).length,
			color: Object.fromEntries(Object.entries(vars.color).slice(0, 30)),
			font: vars.font,
			length: Object.fromEntries(Object.entries(vars.length).slice(0, 15)),
			other: vars.other
		},
		darkMode: { mediaRules: darkRules },
		layout: {
			containers: top(containers, 3).map((c) => ({ px: +c.value, share: c.share })),
			radii: top(radii, 5).map((r) => ({ px: +r.value, share: r.share })),
			boxed: boxedCount,
			sharpShare: boxedCount ? +(sharpCount / boxedCount).toFixed(2) : null,
			pillShare: boxedCount ? +(pillCount / boxedCount).toFixed(2) : null,
			shadows: top(shadows, 3),
			spacing: top(spacing, 10).map((s) => ({ px: +s.value, share: s.share })),
			spacingDiv4: (() => {
				let n = 0, d4 = 0, d8 = 0;
				for (const [v, c] of spacing) { n += c; if (v % 4 === 0) d4 += c; if (v % 8 === 0) d8 += c; }
				return { div4: +(d4 / n).toFixed(2), div8: +(d8 / n).toFixed(2) };
			})(),
			grid: gridCount,
			flex: flexCount
		},
		motion: {
			durations: top(durations, 4).map((d) => ({ ms: +d.value, share: d.share })),
			easings: top(easings, 3),
			animatedElements: animated,
			runningAnimations,
			keyframes,
			reducedMotionRules
		},
		tech,
		generator,
		cmp: { sampledShare: +(cmpHits / pts).toFixed(2) },
		sheets: { total: sheetsTotal, blocked: sheetsBlocked }
	};
}
