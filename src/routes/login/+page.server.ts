import { fail, redirect, type Cookies } from '@sveltejs/kit';
import { api } from '../../convex/_generated/api.js';
import { convex, errorMessage, setSession } from '#lib/server/auth.js';
import type { Actions, PageServerLoad } from './$types';

// Invite links (/login?invite=...) show the signup form instead
export const load: PageServerLoad = ({ url }) => ({ invite: url.searchParams.get('invite') });

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
