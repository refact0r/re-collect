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
