import { ConvexError } from 'convex/values';

export function requireAuth(token: string | undefined) {
	const expected = process.env.CONVEX_WRITE_TOKEN;
	if (!expected || token !== expected) {
		throw new ConvexError('Unauthorized');
	}
}
