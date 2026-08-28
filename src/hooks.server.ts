import type { Handle } from '@sveltejs/kit';
import { COOKIE_NAME, isValidSession } from '$lib/server/auth';

export const handle: Handle = async ({ event, resolve }) => {
	const sessionCookie = event.cookies.get(COOKIE_NAME);
	event.locals.isAuthenticated = sessionCookie ? await isValidSession(sessionCookie) : false;

	// Allow read-only access for unauthenticated users
	return resolve(event);
};
