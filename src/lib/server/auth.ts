import type { Cookies } from '@sveltejs/kit';
import { ConvexHttpClient } from 'convex/browser';
import { ConvexError } from 'convex/values';
import { dev } from '$app/env';
import { PUBLIC_CONVEX_URL } from '$app/env/public';

// Holds the session token, which the client sends with every Convex call
export const COOKIE_NAME = 'session';

export const convex = () => new ConvexHttpClient(PUBLIC_CONVEX_URL);

// The user-facing message of a ConvexError thrown by sessions.login/signup
export function errorMessage(error: unknown) {
	return error instanceof ConvexError ? String(error.data) : 'something went wrong';
}

export function setSession(cookies: Cookies, token: string) {
	cookies.set(COOKIE_NAME, token, {
		path: '/',
		httpOnly: true,
		secure: !dev,
		// lax so the cookie survives the redirect after opening an invite link
		// from another site (chat app, email)
		sameSite: 'lax',
		maxAge: 60 * 60 * 24 * 365
	});
}
