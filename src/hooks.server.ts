import { redirect, type Handle } from '@sveltejs/kit';
import { AUTH_PASSWORD } from '$env/static/private';

const COOKIE_NAME = 'auth-session';

export const handle: Handle = async ({ event, resolve }) => {
	const { pathname } = event.url;

	// Allow access to login page and logout endpoint
	if (pathname === '/login' || pathname === '/logout') {
		return resolve(event);
	}

	const sessionCookie = event.cookies.get(COOKIE_NAME);
	const isAuthenticated = sessionCookie === AUTH_PASSWORD;

	if (!isAuthenticated) {
		throw redirect(303, '/login');
	}

	return resolve(event);
};
