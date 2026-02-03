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
				sameSite: 'strict',
				maxAge: 60 * 60 * 24 * 30
			});

			throw redirect(303, '/');
		}

		return fail(400, { message: 'Invalid password' });
	}
} satisfies Actions;
