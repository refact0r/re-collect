import { env } from '$env/dynamic/private';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	return {
		isAuthenticated: locals.isAuthenticated,
		writeToken: locals.isAuthenticated ? (env.CONVEX_WRITE_TOKEN ?? null) : null
	};
};
