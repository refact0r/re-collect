import type { ConvexClient } from 'convex/browser';
import { goto } from '$app/navigation';
import { page } from '$app/state';
import { loginHref } from '#lib/login.js';
import { api } from '../convex/_generated/api.js';
import type { Id } from '../convex/_generated/dataModel.js';

// Runs a mutation with the session token. An ended session sends the user to
// /login (which clears the dead cookie) and resolves to null.
export async function mutate<T>(
	token: string,
	fn: (token: string) => Promise<T>
): Promise<T | null> {
	try {
		return await fn(token);
	} catch (e) {
		if (e instanceof Error && e.message.includes('Unauthorized')) {
			await goto(loginHref(page.url));
			return null;
		}
		throw e;
	}
}

export function deleteItem(client: ConvexClient, token: string, itemId: Id<'items'>) {
	return mutate(token, (t) => client.mutation(api.items.remove, { id: itemId, token: t }));
}

// Re-fetch a URL item's image in its current mode (shared by the listing pages)
export function retryScreenshot(client: ConvexClient, token: string, itemId: Id<'items'>) {
	return mutate(token, (t) => client.mutation(api.screenshots.reimageItem, { itemId, token: t }));
}
