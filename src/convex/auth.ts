import { ConvexError } from 'convex/values';

export function requireAuth(token: string | undefined) {
	if (token !== process.env.CONVEX_WRITE_TOKEN) {
		throw new ConvexError('Unauthorized');
	}
}
