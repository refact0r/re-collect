import type { Handle } from '@sveltejs/kit/hooks';
import { COOKIE_NAME, isValidSession } from '#lib/server/auth.js';

export const handle: Handle = async ({ event, resolve }) => {
	const sessionCookie = event.cookies.get(COOKIE_NAME);
	event.locals.isAuthenticated = sessionCookie ? await isValidSession(sessionCookie) : false;

	// The (app) layout redirects unauthenticated visitors to /login
	return resolve(event);
};
