import type { Handle } from '@sveltejs/kit';
import { AUTH_PASSWORD } from '$env/static/private';

const COOKIE_NAME = 'auth-session';

export const handle: Handle = async ({ event, resolve }) => {
	const sessionCookie = event.cookies.get(COOKIE_NAME);
	event.locals.isAuthenticated = sessionCookie === AUTH_PASSWORD;

	// Allow read-only access for unauthenticated users
	return resolve(event);
};
