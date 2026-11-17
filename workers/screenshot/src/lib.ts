// Pure helpers for the screenshot worker, kept apart from the runtime code so
// they can be unit tested (lib.spec.ts)

// A URL the worker may load: http(s), and not localhost or a loopback, private
// or link-local address (as a literal). The same rules as isPublicWebUrl in
// src/convex/lib/urls.ts, kept in both runtimes since neither can import the
// other.
export function isValidUrl(url: string): boolean {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return false;
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
	const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
	if (host === 'localhost' || /\.(localhost|local|internal)$/.test(host)) return false;
	// URL parsing already turned 0x7f.1, 2130706433 and the like into dotted form.
	// Blocks 0/8, 10/8, 127/8, 169.254/16, 172.16/12 and 192.168/16.
	const ipv4 = host.match(/^(\d+)\.(\d+)\.\d+\.\d+$/);
	if (ipv4) {
		const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
		return !(
			a === 0 ||
			a === 10 ||
			a === 127 ||
			(a === 169 && b === 254) ||
			(a === 172 && b >= 16 && b <= 31) ||
			(a === 192 && b === 168)
		);
	}
	// IPv6 keeps its brackets: loopback, unspecified, unique-local (fc00::/7),
	// link-local (fe80::/10), IPv4-mapped
	if (host.startsWith('[')) {
		const ipv6 = host.slice(1, -1);
		return !(
			ipv6 === '::1' ||
			ipv6 === '::' ||
			/^f[cd]/.test(ipv6) ||
			/^fe[89ab]/.test(ipv6) ||
			ipv6.startsWith('::ffff:')
		);
	}
	return true;
}

const NAMED_ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: '\u00a0',
	mdash: '\u2014',
	ndash: '\u2013',
	lsquo: '\u2018',
	rsquo: '\u2019',
	ldquo: '\u201c',
	rdquo: '\u201d',
	laquo: '\u00ab',
	raquo: '\u00bb',
	hellip: '\u2026',
	middot: '\u00b7',
	bull: '\u2022',
	copy: '\u00a9',
	reg: '\u00ae',
	trade: '\u2122'
};

// HTMLRewriter hands over attribute values and text exactly as written in the
// source, entities included. One pass, so "&amp;lt;" stays "&lt;". Unknown
// names stay as written; invalid code points become U+FFFD, as in browsers.
// The discovery feed has its own in src/convex/lib/discoverySources.ts: a
// different runtime, and it decodes feed text rather than page markup.
export function decodeEntities(s: string): string {
	return s.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (match, dec, hex, name) => {
		if (name) return NAMED_ENTITIES[name.toLowerCase()] ?? match;
		const code = dec ? parseInt(dec, 10) : parseInt(hex, 16);
		const invalid = code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff);
		return invalid ? '\ufffd' : String.fromCodePoint(code);
	});
}

// What document.title does to a <title>: whitespace runs (newlines included)
// become one space
export function collapseWhitespace(s: string): string {
	return s.replace(/\s+/g, ' ').trim();
}

// Analytics and ad hosts whose requests keep the network from going idle.
// Matched on the hostname, so a site's own /advertising-campaign.jpg loads.
const TRACKER_DOMAINS = [
	'google-analytics.com',
	'googletagmanager.com',
	'doubleclick.net',
	'googlesyndication.com',
	'googleadservices.com',
	'adservice.google.com',
	'amazon-adsystem.com',
	'advertising.com',
	'hotjar.com',
	'hotjar.io',
	'segment.com',
	'segment.io',
	'mixpanel.com',
	'mxpnl.com'
];

export function isTrackerRequest(url: string): boolean {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return false;
	}
	const host = parsed.hostname.toLowerCase();
	if (host.startsWith('analytics.')) return true;
	// The Meta pixel is a path on facebook.com itself
	if (
		(host === 'facebook.com' || host.endsWith('.facebook.com')) &&
		(parsed.pathname === '/tr' || parsed.pathname.startsWith('/tr/'))
	) {
		return true;
	}
	return TRACKER_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

// Trackers, beacons ('ping') and sockets keep the network from going idle. The
// page's own navigation is never blocked (e.g. capturing an analytics vendor's
// site), but an iframe's is, so ad and tracker iframes stay out.
export function blocksRequest(url: string, resourceType: string, isPage: boolean): boolean {
	if (isPage) return false;
	return resourceType === 'ping' || resourceType === 'websocket' || isTrackerRequest(url);
}

// Status and message for a failed capture. Navigation errors carry the page
// URL, so they're matched first, and only errors thrown while acquiring the
// browser count as Browser Rendering limits (launch rate, concurrency, daily
// time): those pass through as 429 so the caller retries with backoff.
export function classifyError(
	message: string,
	acquiringBrowser: boolean
): { status: number; error: string } {
	if (message.includes('net::ERR_NAME_NOT_RESOLVED')) {
		return { status: 502, error: 'Domain not found' };
	}
	if (message.includes('net::ERR_CONNECTION_REFUSED')) {
		return { status: 502, error: 'Connection refused' };
	}
	if (message.includes('net::ERR_')) return { status: 502, error: 'Failed to load page' };
	if (acquiringBrowser && /429|rate limit|too many|limit exceeded/i.test(message)) {
		return { status: 429, error: 'Browser rendering rate limited' };
	}
	if (/timeout/i.test(message)) return { status: 504, error: 'Page load timeout' };
	if (message.includes('Navigation')) return { status: 502, error: 'Failed to load page' };
	return { status: 500, error: 'Failed to capture screenshot' };
}

// Same folding as fontSearchKey in src/convex/lib/fonts.ts
const foldName = (name: string) =>
	name
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]/g, '');

// Of the fonts Chromium actually used for an element, pick the one that
// corresponds to the CSS family (an element can mix fonts)
export function pickInternalName(
	family: string,
	used: { familyName: string; isCustomFont: boolean; glyphCount: number }[]
): string | undefined {
	const custom = used.filter((f) => f.isCustomFont && f.familyName.trim());
	if (custom.length === 0) return undefined;
	const key = foldName(family);
	const match = custom.find((f) => {
		const name = foldName(f.familyName);
		return name.includes(key) || key.includes(name) || name.slice(0, 3) === key.slice(0, 3);
	});
	return (match ?? custom.reduce((a, b) => (b.glyphCount > a.glyphCount ? b : a))).familyName;
}
