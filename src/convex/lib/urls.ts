// Item links must be web pages: anything else (javascript:, data:, ...) is
// unsafe in an href shown to visitors of a shared collection, and the
// screenshot worker couldn't fetch it anyway
export function isWebUrl(value: string): boolean {
	try {
		const { protocol } = new URL(value);
		return protocol === 'http:' || protocol === 'https:';
	} catch {
		return false;
	}
}

// A web URL the server may fetch on someone's behalf: not localhost or a
// loopback, private or link-local address (as a literal; names that resolve to
// one aren't caught). The same rules as isValidUrl in
// workers/screenshot/src/lib.ts, kept in both runtimes since neither can
// import the other.
export function isPublicWebUrl(value: string): boolean {
	if (!isWebUrl(value)) return false;
	const host = new URL(value).hostname.toLowerCase().replace(/\.$/, '');
	if (host === 'localhost' || /\.(localhost|local|internal)$/.test(host)) return false;
	// URL parsing already turned 0x7f.1, 2130706433 and the like into dotted form
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

// One key per page, for spotting the same link twice (items, discovery
// candidates): no protocol, www, trailing slash, hash or tracking params
export function normalizeUrl(value: string): string {
	try {
		const url = new URL(value);
		url.hash = '';
		for (const param of [...url.searchParams.keys()]) {
			if (/^(ref|utm_.*|via|source)$/i.test(param)) url.searchParams.delete(param);
		}
		const host = url.hostname.replace(/^www\./, '').toLowerCase();
		const path = url.pathname.replace(/\/+$/, '');
		return `${host}${path}${url.search}`;
	} catch {
		return value;
	}
}
