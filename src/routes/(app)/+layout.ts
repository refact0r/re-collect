import { redirect } from '@sveltejs/kit';
import { loginHref } from '#lib/login.js';
import type { LayoutLoad } from './$types';

// Logged-out visitors may only open shared collections; every other page is the
// signed-in user's own data. A universal load, so a client-side navigation
// checks this without a request. It reads the route (and the URL, only to
// redirect) only without a token, so a signed-in user never re-runs it.
export const load: LayoutLoad = ({ data, route, url }) => {
	if (!data.writeToken && route.id !== '/(app)/collections/[id]') {
		redirect(303, loginHref(url));
	}
	return data;
};
