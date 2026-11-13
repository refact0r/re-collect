import { fail, redirect, type Cookies } from '@sveltejs/kit';
import { ConvexError } from 'convex/values';
import { api } from '../../convex/_generated/api.js';
import { COOKIE_NAME, convex, errorMessage, setSession } from '#lib/server/auth.js';
import type { Actions, PageServerLoad } from './$types';

// Invite links (/login?invite=...) show the signup form instead. A live session
// goes straight to the app; a dead one (signed out elsewhere, which is how the
// app sends people here) has its cookie cleared.
export const load: PageServerLoad = async ({ url, cookies }) => {
	const invite = url.searchParams.get('invite');
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
		if (live && !invite) redirect(303, '/');
	}
	return { invite };
};

async function signIn(cookies: Cookies, session: Promise<string>) {
	try {
		setSession(cookies, await session);
	} catch (error) {
		return fail(400, { message: errorMessage(error) });
	}
	redirect(303, '/');
}

export const actions = {
	login: async ({ request, cookies }) => {
		const form = await request.formData();
		return signIn(
			cookies,
			convex().action(api.sessions.login, {
				username: String(form.get('username') ?? ''),
				password: String(form.get('password') ?? '')
			})
		);
	},
	signup: async ({ request, cookies }) => {
		const form = await request.formData();
		return signIn(
			cookies,
			convex().action(api.sessions.signup, {
				invite: String(form.get('invite') ?? ''),
				username: String(form.get('username') ?? ''),
				password: String(form.get('password') ?? '')
			})
		);
	}
} satisfies Actions;
