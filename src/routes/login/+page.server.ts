import { fail, redirect, type Cookies } from '@sveltejs/kit';
import { ConvexError } from 'convex/values';
import { api } from '../../convex/_generated/api.js';
import { COOKIE_NAME, convex, errorMessage, setSession } from '#lib/server/auth.js';
import type { Actions, PageServerLoad } from './$types';

// Where to go after signing in: `?next=` when it resolves to this site (a
// shared collection the visitor was looking at), else home. Resolving it the
// way a browser would catches tricks like `/\t/evil.com` (tabs are stripped).
function nextPath(next: unknown, origin: string) {
	if (typeof next !== 'string') return '/';
	try {
		const target = new URL(next, origin);
		return target.origin === origin ? target.pathname + target.search : '/';
	} catch {
		return '/';
	}
}

// Invite links (/login?invite=...) show the signup form instead. A live session
// goes straight on; a dead one (signed out elsewhere, which is how the app
// sends people here) has its cookie cleared.
export const load: PageServerLoad = async ({ url, cookies }) => {
	const invite = url.searchParams.get('invite');
	const next = nextPath(url.searchParams.get('next'), url.origin);
	const token = cookies.get(COOKIE_NAME);
	if (token) {
		const live = await convex()
			.query(api.users.me, { token })
			.then(
				() => true,
				(error) => {
					if (error instanceof ConvexError && error.data === 'Unauthorized') {
						cookies.delete(COOKIE_NAME, { path: '/' });
					}
					return false;
				}
			);
		if (live && !invite) redirect(303, next);
	}
	return { invite, next };
};

async function signIn(cookies: Cookies, next: string, session: Promise<string>) {
	try {
		setSession(cookies, await session);
	} catch (error) {
		return fail(400, { message: errorMessage(error) });
	}
	redirect(303, next);
}

export const actions = {
	login: async ({ request, cookies, url }) => {
		const form = await request.formData();
		return signIn(
			cookies,
			nextPath(form.get('next'), url.origin),
			convex().action(api.sessions.login, {
				username: String(form.get('username') ?? ''),
				password: String(form.get('password') ?? '')
			})
		);
	},
	signup: async ({ request, cookies, url }) => {
		const form = await request.formData();
		return signIn(
			cookies,
			nextPath(form.get('next'), url.origin),
			convex().action(api.sessions.signup, {
				invite: String(form.get('invite') ?? ''),
				username: String(form.get('username') ?? ''),
				password: String(form.get('password') ?? '')
			})
		);
	}
} satisfies Actions;
