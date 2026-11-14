import { ConvexHttpClient } from 'convex/browser';
import { PUBLIC_CONVEX_URL } from '$app/env/public';
import { api } from '../../../../convex/_generated/api.js';
import type { PageLoad } from './$types';

// A logged-out visit to a shared link (a person, or a chat app fetching a link
// preview) gets the collection during SSR: it fills the preview meta tags, and
// the page starts from it instead of a loading state. Going through SvelteKit's
// fetch inlines the response, so hydration reuses it. Signed-in users skip
// this; their page loads the collection from Convex like any other.
export const load: PageLoad = async ({ params, parent, fetch }) => {
	const { writeToken } = await parent();
	if (writeToken) return { collection: null };
	const convex = new ConvexHttpClient(PUBLIC_CONVEX_URL, { fetch });
	const collection = await convex.query(api.collections.get, { id: params.id });
	return { collection, title: collection?.name };
};
