import { fail, redirect } from '@sveltejs/kit';
import { isValidCode, setSession } from '#lib/server/auth.js';
import type { Actions, PageServerLoad } from './$types';

// Login links (/login?code=...) sign in directly
export const load: PageServerLoad = async ({ url, cookies }) => {
	const code = url.searchParams.get('code');
	if (code && (await isValidCode(code))) {
		setSession(cookies, code);
		redirect(303, '/');
	}
	return { invalidLink: !!code };
};

export const actions = {
	default: async ({ request, cookies }) => {
		const code = (await request.formData()).get('code');
		if (typeof code === 'string' && (await isValidCode(code.trim()))) {
			setSession(cookies, code.trim());
			redirect(303, '/');
		}
		return fail(400, { message: 'invalid code' });
	}
} satisfies Actions;
