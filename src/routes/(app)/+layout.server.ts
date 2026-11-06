import { redirect } from '@sveltejs/kit';
import { COOKIE_NAME } from '#lib/server/auth.js';
import type { LayoutServerLoad } from './$types';

// Every Convex query is scoped to the signed-in user, so visitors without a
// session go to the login page. The token itself is checked by Convex.
export const load: LayoutServerLoad = async ({ cookies }) => {
	const writeToken = cookies.get(COOKIE_NAME);
	if (!writeToken) redirect(303, '/login');
	return { writeToken };
};
