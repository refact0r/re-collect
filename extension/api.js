// Minimal client for Convex's HTTP API (POST /api/{query,mutation,action}).
// Every call carries the extension's session token, from "copy extension token"
// on the app's account page; the backend resolves it to the signed-in user.

export async function getSettings() {
	const { convexUrl = '', token = '' } = await chrome.storage.local.get(['convexUrl', 'token']);
	return { convexUrl, token };
}

// The context menu saves to whichever collection the popup last used ('' = uncollected)
export async function getLastCollection() {
	const { lastCollection = { id: '', name: '' } } =
		await chrome.storage.local.get('lastCollection');
	return lastCollection;
}

export function setLastCollection(lastCollection) {
	return chrome.storage.local.set({ lastCollection });
}

async function call(kind, path, args = {}) {
	const { convexUrl, token } = await getSettings();
	if (!convexUrl) throw new Error('Set the Convex URL in the extension options');

	const response = await fetch(`${convexUrl.replace(/\/+$/, '')}/api/${kind}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			path,
			args: { ...args, token },
			format: 'json'
		})
	});
	const body = await response.json().catch(() => null);
	if (body?.status === 'success') return body.value;
	// User-facing failures are ConvexErrors, whose message arrives as errorData
	if (body?.errorData === 'Unauthorized') {
		throw new Error('Token not recognized — create a new extension token in re-collect');
	}
	throw new Error(body?.errorData ?? body?.errorMessage ?? `Request failed (${response.status})`);
}

export function getMe() {
	return call('query', 'users:me');
}

export function listCollections() {
	return call('query', 'collections:list');
}

// Ingestion defaults for uncollected saves
export function getHomePreferences() {
	return call('query', 'viewPreferences:get', { key: 'home' });
}

// "Already saved Nov 3, 2026" for the newest saved copy of this page, or null.
// A failed check counts as not saved: it only ever warns, never blocks a save.
export async function savedNote(url) {
	const [latest] = await call('query', 'items:findByUrl', { url }).catch(() => []);
	if (!latest) return null;
	const date = new Date(latest.dateAdded).toLocaleDateString(undefined, { dateStyle: 'medium' });
	return `Already saved ${date}`;
}

function collectionsArg(collectionId) {
	return collectionId ? [collectionId] : undefined;
}

// taggingMode / linkImageMode override the collection's defaults when set
export function saveUrl({ url, title, collectionId, taggingMode, linkImageMode }) {
	return call('mutation', 'items:add', {
		type: 'url',
		url,
		title: title || undefined,
		collections: collectionsArg(collectionId),
		taggingMode,
		linkImageMode
	});
}

// Resolves to { itemId, type }; type is 'url' when the image couldn't be fetched
// and the page was saved instead
export function saveImage({ imageUrl, pageUrl, collectionId }) {
	return call('action', 'imageImport:addFromUrl', {
		imageUrl,
		pageUrl,
		collections: collectionsArg(collectionId)
	});
}

// Saves a page with an extension-captured screenshot (data: URL) instead of the worker's
export function savePageWithImage({
	url,
	title,
	ogDescription,
	imageUrl,
	collectionId,
	taggingMode
}) {
	return call('action', 'imageImport:addPageWithImage', {
		url,
		title: title || undefined,
		ogDescription: ogDescription || undefined,
		imageUrl,
		collections: collectionsArg(collectionId),
		taggingMode
	});
}
