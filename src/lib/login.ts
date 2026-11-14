// The login page, set to come back to `url` afterwards (without an open item modal)
export function loginHref(url: { href: string }) {
	const back = new URL(url.href);
	back.searchParams.delete('item');
	const next = back.pathname + back.search;
	return next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`;
}
