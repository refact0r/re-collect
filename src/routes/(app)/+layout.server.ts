import { redirect } from '@sveltejs/kit';
import { CONVEX_WRITE_TOKEN } from '$app/env/private';
import type { LayoutServerLoad } from './$types';

// Every Convex query is scoped to the signed-in user, so logged-out visitors
// get nothing and go to the login page instead
export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.isAuthenticated || !CONVEX_WRITE_TOKEN) redirect(303, '/login');
	return { writeToken: CONVEX_WRITE_TOKEN };
};
