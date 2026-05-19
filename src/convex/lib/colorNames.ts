// Map palette hex codes to named-color search tokens.
//
// Each palette hex is converted to OKLCh and compared against a curated anchor
// table using a chord-ΔH distance (ΔL² + ΔC² + ΔH_chord²). OKLCh's better hue
// linearity (vs CIE Lab) keeps blue/purple-region matches sane — cerulean's
// nearest neighbors are cyan-family colors instead of purples. Every anchor
// within DISTANCE_THRESHOLD contributes its name, so a single hex can produce
// several synonyms (e.g. navy → "navy", "indigo"). Achromatic palette colors
// are gated against achromatic anchors only so a near-grey doesn't pick up a
// hue name by chance.
//
// Anchors are single-word names only: compound xkcd names like "navy blue" are
// excluded since they tokenize to ["navy", "blue"] in full-text search and
// produce false-positives (e.g. "olive green" surfacing for "green" queries).
// Matching runs in two passes per palette hex: (1) a strict pass against the
// full anchor table at DISTANCE_THRESHOLD finds specific names (lavender,
// lilac, periwinkle); (2) a permissive pass against just the basic-color
// anchors at BASIC_DISTANCE_THRESHOLD finds the coarse-color memberships
// (purple, blue) directly from the hex. The basic pass replaces an older
// parent-inheritance map, which drifted when a marginal specific match
// dragged in unrelated parents (e.g. an orange-gray matching khaki, whose
// parents included green).

const DISTANCE_THRESHOLD = 0.15;
const BASIC_DISTANCE_THRESHOLD = 0.25;
const CHROMA_THRESHOLD = 0.04;
// Multiplier on the hue chord term in oklchDistance. The unweighted chord
// scales with √(C₁C₂), which is weak enough that distant hues can clear the
// threshold via close L/C alone (e.g. cerulean leaking onto desaturated
// purples). Weighting hue separates the families without a hard angular cap.
const HUE_WEIGHT = 2.5;

// 45 single-word names from the bottom 100 of xkcd.com/color/rgb.txt
// (most-popular survey results), plus 17 manual additions: white, gray
// (American spelling alias for grey), cream, coral, silver, charcoal,
// crimson, amber, emerald, scarlet, azure, sienna, umber, viridian,
// carmine, fuchsia, auburn.
const ANCHOR_HEX: Record<string, string> = {
	ochre: '#bf9005',
	cerulean: '#0485d1',
	rust: '#a83c09',
	slate: '#516572',
	goldenrod: '#fac205',
	seafoam: '#80f9ad',
	chartreuse: '#c1f80a',
	taupe: '#b9a281',
	khaki: '#aaa662',
	burgundy: '#610023',
	plum: '#580f41',
	gold: '#dbb40c',
	navy: '#01153e',
	aquamarine: '#04d8b2',
	rose: '#cf6275',
	mustard: '#ceb301',
	indigo: '#380282',
	lime: '#aaff32',
	periwinkle: '#8e82fe',
	peach: '#ffb07c',
	lilac: '#cea2fd',
	beige: '#e6daa6',
	salmon: '#ff796c',
	olive: '#6e750e',
	maroon: '#650021',
	mauve: '#ae7181',
	aqua: '#13eac9',
	cyan: '#00ffff',
	tan: '#d1b26f',
	lavender: '#c79fef',
	turquoise: '#06c2ac',
	violet: '#9a0eea',
	magenta: '#c20078',
	teal: '#029386',
	brown: '#653700',
	pink: '#ff81c0',
	blue: '#0343df',
	green: '#15b01a',
	purple: '#7e1e9c',
	mint: '#9ffeb0',
	black: '#000000',
	grey: '#929591',
	yellow: '#ffff14',
	orange: '#f97306',
	red: '#e50000',
	white: '#ffffff',
	gray: '#929591',
	cream: '#ffffc2',
	coral: '#fc5a50',
	silver: '#c5c9c7',
	charcoal: '#343837',
	crimson: '#8c000f',
	amber: '#feb308',
	emerald: '#01a049',
	scarlet: '#be0119',
	azure: '#069af3',
	sienna: '#a9561e',
	umber: '#b26400',
	viridian: '#1e9167',
	carmine: '#9d0216',
	fuchsia: '#ed0dd9',
	auburn: '#9a3001'
};

// Basic-color names run as a second pass at BASIC_DISTANCE_THRESHOLD, so the
// coarse-color tag for a hex is derived directly from its position in OKLCh
// rather than inherited from whatever specific anchors happened to match.
const BASIC_NAMES = new Set([
	'red',
	'orange',
	'yellow',
	'green',
	'blue',
	'purple',
	'pink',
	'brown',
	'white',
	'grey',
	'gray',
	'black'
]);

type Oklch = { L: number; C: number; h: number };
type Anchor = { name: string; lch: Oklch };

function hexToRgb(hex: string): [number, number, number] {
	const h = hex.startsWith('#') ? hex.slice(1) : hex;
	const r = parseInt(h.slice(0, 2), 16);
	const g = parseInt(h.slice(2, 4), 16);
	const b = parseInt(h.slice(4, 6), 16);
	return [r, g, b];
}

function srgbToLinear(c: number): number {
	const x = c / 255;
	return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}

function hexToOklch(hex: string): Oklch {
	const [r, g, b] = hexToRgb(hex);
	const lr = srgbToLinear(r);
	const lg = srgbToLinear(g);
	const lb = srgbToLinear(b);
	// linear sRGB → LMS (Björn Ottosson, OKLab spec)
	const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
	const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
	const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;
	const l_ = Math.cbrt(l);
	const m_ = Math.cbrt(m);
	const s_ = Math.cbrt(s);
	// L'M'S' → OKLab
	const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
	const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
	const bb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
	const C = Math.sqrt(a * a + bb * bb);
	const h = Math.atan2(bb, a);
	return { L, C, h };
}

// OKLCh chord distance: ΔH_chord = 2·√(C₁C₂)·sin(Δh/2) naturally weights hue
// difference by both colors' chromaticity, so near-grey hexes don't blow up
// from large but irrelevant hue swings.
function oklchDistance(p: Oklch, q: Oklch): number {
	const dL = p.L - q.L;
	const dC = p.C - q.C;
	let dh = p.h - q.h;
	while (dh > Math.PI) dh -= 2 * Math.PI;
	while (dh < -Math.PI) dh += 2 * Math.PI;
	const dH = HUE_WEIGHT * 2 * Math.sqrt(p.C * q.C) * Math.sin(dh / 2);
	return Math.sqrt(dL * dL + dC * dC + dH * dH);
}

const ANCHORS: Anchor[] = Object.entries(ANCHOR_HEX).map(([name, hex]) => ({
	name,
	lch: hexToOklch(hex)
}));
const BASIC_ANCHORS: Anchor[] = ANCHORS.filter((a) => BASIC_NAMES.has(a.name));

export function colorNamesForPalette(paletteHex: string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	const add = (name: string) => {
		if (!seen.has(name)) {
			seen.add(name);
			out.push(name);
		}
	};
	const matchPass = (lch: Oklch, achromatic: boolean, anchors: Anchor[], threshold: number) => {
		for (const anchor of anchors) {
			const anchorAchromatic = anchor.lch.C < CHROMA_THRESHOLD;
			if (achromatic !== anchorAchromatic) continue;
			if (oklchDistance(lch, anchor.lch) < threshold) add(anchor.name);
		}
	};
	for (const hex of paletteHex) {
		if (!/^#?[0-9a-fA-F]{6}$/.test(hex)) continue;
		const lch = hexToOklch(hex);
		const achromatic = lch.C < CHROMA_THRESHOLD;
		matchPass(lch, achromatic, ANCHORS, DISTANCE_THRESHOLD);
		matchPass(lch, achromatic, BASIC_ANCHORS, BASIC_DISTANCE_THRESHOLD);
	}
	return out;
}
