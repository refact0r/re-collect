import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const COOKIE_NAME = 'auth-session';

export const GET: RequestHandler = async ({ cookies }) => {
	cookies.delete(COOKIE_NAME, { path: '/' });
	throw redirect(303, '/login');
};
