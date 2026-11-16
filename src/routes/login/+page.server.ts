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

// Whether `path` is a collection page a signed-out visitor may view (a shared one);
// a failed check counts as no
async function sharedCollection(path: string) {
	const id = path.match(/^\/collections\/([^/?]+)(\?|$)/)?.[1];
	if (!id) return false;
	const collection = await convex()
		.query(api.collections.get, { id })
		.catch(() => null);
	return collection !== null;
}

// Invite links (/login?invite=...) show the signup form instead. A live session
// goes straight on; a dead one (signed out elsewhere, which is how the app
// sends people here) has its cookie cleared and, sent from a shared collection,
// goes back to it as a visitor.
export const load: PageServerLoad = async ({ url, cookies }) => {
	const invite = url.searchParams.get('invite');
	const next = nextPath(url.searchParams.get('next'), url.origin);
	const token = cookies.get(COOKIE_NAME);
	if (token) {
		const session = await convex()
			.query(api.users.me, { token })
			.then(
				() => 'live',
				(error) =>
					error instanceof ConvexError && error.data === 'Unauthorized' ? 'dead' : 'unknown'
			);
		if (session === 'dead') cookies.delete(COOKIE_NAME, { path: '/' });
		const goOn =
			!invite && (session === 'live' || (session === 'dead' && (await sharedCollection(next))));
		if (goOn) redirect(303, next);
	}
	return { invite, next };
};

// A new session replaces any the cookie held, which is ended (best effort)
async function signIn(cookies: Cookies, next: string, session: Promise<string>) {
	const previous = cookies.get(COOKIE_NAME);
	try {
		setSession(cookies, await session);
	} catch (error) {
		return fail(400, { message: errorMessage(error) });
	}
	if (previous) {
		await convex()
			.mutation(api.sessions.logout, { token: previous })
			.catch(() => {});
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
