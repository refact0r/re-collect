import { fail, redirect } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { AUTH_PASSWORD } from '$env/static/private';
import type { Actions } from './$types';

const COOKIE_NAME = 'auth-session';

export const actions = {
	default: async ({ request, cookies }) => {
		const data = await request.formData();
		const password = data.get('password') as string;

		if (password === AUTH_PASSWORD) {
			cookies.set(COOKIE_NAME, AUTH_PASSWORD, {
				path: '/',
				httpOnly: true,
				secure: !dev,
				// NOTE: Using 'lax' in dev to allow cookies through ngrok (cross-site context).
				// 'strict' blocks cookies when domain changes (localhost → ngrok).
				// TODO: Decide if we want to keep 'lax' in dev or require local testing only.
				sameSite: dev ? 'lax' : 'strict',
				maxAge: 60 * 60 * 24 * 30
			});

			throw redirect(303, '/');
		}

		return fail(400, { message: 'Invalid password' });
	}
} satisfies Actions;
