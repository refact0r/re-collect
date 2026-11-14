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
