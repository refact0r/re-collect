import { CONVEX_WRITE_TOKEN } from '$app/env/private';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	return {
		isAuthenticated: locals.isAuthenticated,
		writeToken: locals.isAuthenticated ? (CONVEX_WRITE_TOKEN ?? null) : null
	};
};
