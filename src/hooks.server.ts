import type { Handle } from '@sveltejs/kit';
import { COOKIE_NAME, safeEqual, sessionToken } from '$lib/server/auth';

export const handle: Handle = async ({ event, resolve }) => {
	const sessionCookie = event.cookies.get(COOKIE_NAME);
	event.locals.isAuthenticated = sessionCookie
		? await safeEqual(sessionCookie, await sessionToken())
		: false;

	// Allow read-only access for unauthenticated users
	return resolve(event);
};
