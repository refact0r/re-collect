import type { Cookies } from '@sveltejs/kit';
import { ConvexHttpClient } from 'convex/browser';
import { dev } from '$app/env';
import { PUBLIC_CONVEX_URL } from '$app/env/public';
import { api } from '../../convex/_generated/api.js';

// Holds the user's access code, which the client sends with every Convex call
export const COOKIE_NAME = 'access-code';

export async function isValidCode(code: string): Promise<boolean> {
	try {
		await new ConvexHttpClient(PUBLIC_CONVEX_URL).query(api.users.me, { token: code });
		return true;
	} catch {
		return false;
	}
}

export function setSession(cookies: Cookies, code: string) {
	cookies.set(COOKIE_NAME, code, {
		path: '/',
		httpOnly: true,
		secure: !dev,
		// lax so the cookie survives the redirect after opening a login link
		// from another site (chat app, email)
		sameSite: 'lax',
		maxAge: 60 * 60 * 24 * 365
	});
}
