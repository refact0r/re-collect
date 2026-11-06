import { redirect } from '@sveltejs/kit';
import { api } from '../../convex/_generated/api.js';
import { COOKIE_NAME, convex } from '#lib/server/auth.js';
import type { RequestHandler } from './$types';

// POST so logout can't be triggered cross-site via a GET (link, <img>, prefetch)
export const POST: RequestHandler = async ({ cookies }) => {
	const token = cookies.get(COOKIE_NAME);
	// Ending the session server-side is best effort; the cookie goes regardless
	if (token) {
		await convex()
			.mutation(api.sessions.logout, { token })
			.catch(() => {});
	}
	cookies.delete(COOKIE_NAME, { path: '/' });
	redirect(303, '/login');
};
