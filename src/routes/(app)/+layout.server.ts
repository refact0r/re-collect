import { COOKIE_NAME } from '#lib/server/auth.js';
import type { LayoutServerLoad } from './$types';

// The token itself is checked by Convex; +layout.ts decides where a visitor
// without one may go
export const load: LayoutServerLoad = async ({ cookies }) => {
	return { writeToken: cookies.get(COOKIE_NAME) ?? null };
};
