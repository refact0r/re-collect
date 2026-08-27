import { redirect } from '@sveltejs/kit';
import { COOKIE_NAME } from '$lib/server/auth';
import type { RequestHandler } from './$types';

// POST so logout can't be triggered cross-site via a GET (link, <img>, prefetch)
export const POST: RequestHandler = async ({ cookies }) => {
	cookies.delete(COOKIE_NAME, { path: '/' });
	throw redirect(303, '/login');
};
