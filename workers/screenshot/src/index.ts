import puppeteer, { type Browser, type HTTPRequest, type Page } from '@cloudflare/puppeteer';
import { imageSize } from 'image-size';
import { readFonts, type SiteFont } from './fonts.js';
import {
	blocksRequest,
	classifyError,
	collapseWhitespace,
	decodeEntities,
	isValidUrl
} from './lib.js';

// Minimal DOM globals for code running inside page.evaluate — the worker
// tsconfig has no DOM lib, and these only exist in the browser context.
declare const document: {
	querySelector(selector: string): { getAttribute(name: string): string | null } | null;
	baseURI: string;
};

interface Env {
	BROWSER: Fetcher;
	R2_BUCKET: R2Bucket;
	API_KEY: string;
}

interface ScreenshotRequest {
	url: string;
	itemId: string;
	// 'og' tries the page's og:image first, falling back to a screenshot
	mode?: 'screenshot' | 'og';
}

interface ScreenshotResponse {
	imageKey: string;
	width: number;
	height: number;
	captureTimeMs: number;
	title?: string;
	description?: string;
	// Only present when the page was rendered in the browser (not the og fast path)
	fonts?: SiteFont[];
}

const VIEWPORT_WIDTH = 1440;
const VIEWPORT_HEIGHT = 900;

const NAVIGATION_TIMEOUT = 10000; // until domcontentloaded
const NETWORKIDLE_TIMEOUT = 10000;
const SETTLE_DELAY = 5000; // after network idle, for loading animations and client-side rendering

const MIN_OG_WIDTH = 400; // narrower og:images are logos or favicons: screenshot instead
const OG_FETCH_TIMEOUT = 10000;
const MAX_OG_BYTES = 20 * 1024 * 1024;
// The og:image types kept, by image-size's name for them (also their file extension)
const IMAGE_TYPES: Record<string, string> = {
	jpg: 'image/jpeg',
	png: 'image/png',
	webp: 'image/webp',
	gif: 'image/gif',
	avif: 'image/avif'
};
// Some CDNs serve images untyped; those are kept when the bytes sniff as one
const OCTET_STREAM = ['application/octet-stream', 'binary/octet-stream'];

const USER_AGENT =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
// Sent on every request in the browser; the plain fetch of the HTML adds Accept
const LANGUAGE_HEADERS = { 'Accept-Language': 'en-US,en;q=0.9' };
const HTML_HEADERS = {
	...LANGUAGE_HEADERS,
	Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
};

function mimeType(response: Response): string {
	return response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? '';
}

interface Upload {
	imageKey: string;
	body: ArrayBuffer | ArrayBufferView;
	contentType: string;
	width: number;
	height: number;
}

async function store(env: Env, { imageKey, body, contentType, width, height }: Upload) {
	await env.R2_BUCKET.put(imageKey, body, {
		httpMetadata: { contentType, cacheControl: 'public, max-age=31536000, immutable' }
	});
	return { imageKey, width, height };
}

// Download an og:image (an absolute URL), ready to store. Null whenever the
// image is unusable (unfetchable, too small or large, not a raster image), so
// the caller can fall back to a screenshot.
async function fetchOgImage(
	imageUrl: string,
	pageUrl: string,
	itemId: string
): Promise<Upload | null> {
	try {
		const response = await fetch(imageUrl, {
			headers: { 'User-Agent': USER_AGENT, Referer: pageUrl },
			signal: AbortSignal.timeout(OG_FETCH_TIMEOUT)
		});
		if (!response.ok) return null;
		const declared = mimeType(response);
		if (!Object.values(IMAGE_TYPES).includes(declared) && !OCTET_STREAM.includes(declared)) {
			return null;
		}
		if (Number(response.headers.get('content-length')) > MAX_OG_BYTES) return null;

		const buffer = await response.arrayBuffer();
		if (buffer.byteLength > MAX_OG_BYTES) return null;
		// Stored as the type the bytes are, whatever the server called them
		const dims = imageSize(new Uint8Array(buffer));
		const contentType = dims.type ? IMAGE_TYPES[dims.type] : undefined;
		// EXIF orientations 5-8 are turned a quarter, so browsers show them on their side
		const [width, height] =
			(dims.orientation ?? 1) >= 5 ? [dims.height, dims.width] : [dims.width, dims.height];
		if (!contentType || !width || !height || width < MIN_OG_WIDTH) {
			console.log(`og:image rejected (${dims.type} ${width}x${height}): ${imageUrl}`);
			return null;
		}
		const imageKey = `og/${itemId}-${Date.now()}.${dims.type}`;
		return { imageKey, body: buffer, contentType, width, height };
	} catch (error) {
		console.log(
			`og:image fetch failed: ${imageUrl}`,
			error instanceof Error ? error.message : error
		);
		return null;
	}
}

// Constant-time check of the bearer token; fails closed when API_KEY is unset
async function isAuthorized(header: string | null, apiKey: string | undefined): Promise<boolean> {
	if (!apiKey || !header) return false;
	const encoder = new TextEncoder();
	const [given, expected] = await Promise.all(
		[header, `Bearer ${apiKey}`].map((s) => crypto.subtle.digest('SHA-256', encoder.encode(s)))
	);
	return crypto.subtle.timingSafeEqual(given, expected);
}

// Fast og path: fetch the page HTML directly and extract the og:image without
// launching a browser (Browser Rendering free plan allows only ~10 min/day and
// 1 launch per 20s). Returns no result on any failure so the caller can fall
// back to the full browser flow, plus the og:image URL if that was what failed,
// so the browser doesn't fetch the same image again.
async function tryOgFast(
	env: Env,
	url: string,
	itemId: string
): Promise<{ result?: ScreenshotResponse; rejectedImage?: string }> {
	const startTime = Date.now();
	try {
		const pageResponse = await fetch(url, {
			headers: { 'User-Agent': USER_AGENT, ...HTML_HEADERS },
			signal: AbortSignal.timeout(OG_FETCH_TIMEOUT)
		});
		if (!pageResponse.ok) return {};
		const pageType = mimeType(pageResponse);
		if (pageType !== 'text/html' && pageType !== 'application/xhtml+xml') return {};

		// The first content of each meta property or name
		const meta = new Map<string, string>();
		const page = { title: '', baseHref: '' };
		let titles = 0;
		const rewriter = new HTMLRewriter()
			.on('meta', {
				element(el) {
					const content = collapseWhitespace(decodeEntities(el.getAttribute('content') ?? ''));
					const key = (el.getAttribute('property') ?? el.getAttribute('name'))?.toLowerCase();
					if (content && key && !meta.has(key)) meta.set(key, content);
				}
			})
			.on('base', {
				element(el) {
					const href = el.getAttribute('href');
					if (href && !page.baseHref) page.baseHref = decodeEntities(href);
				}
			})
			// Not "head > title": <head> is optional. Only the first <title> is the
			// document's; later ones belong to inline SVGs.
			.on('title', {
				element() {
					titles++;
				},
				text(t) {
					if (titles === 1) page.title += t.text;
				}
			});
		// Handlers only run as the transformed body is consumed
		await rewriter.transform(pageResponse).arrayBuffer();

		const rawImage = meta.get('og:image') ?? meta.get('twitter:image');
		if (!rawImage) return {};

		// Resolve relative URLs against <base href> or the final (post-redirect) URL
		const pageUrl = pageResponse.url || url;
		const base = page.baseHref ? new URL(page.baseHref, pageUrl).href : pageUrl;
		const imageUrl = new URL(rawImage, base).href;

		const image = await fetchOgImage(imageUrl, pageUrl, itemId);
		if (!image) return { rejectedImage: imageUrl };

		// Decoded once the chunks are joined, since an entity can span two chunks
		const title =
			collapseWhitespace(decodeEntities(page.title)) ||
			meta.get('og:title') ||
			meta.get('twitter:title');
		return {
			result: {
				...(await store(env, image)),
				captureTimeMs: Date.now() - startTime,
				title: title || undefined,
				description: meta.get('og:description') ?? meta.get('description')
			}
		};
	} catch (error) {
		console.log(`fast og fetch failed: ${url}`, error instanceof Error ? error.message : error);
		return {};
	}
}

async function preparePage(page: Page) {
	await page.setViewport({ width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT });
	await page.setExtraHTTPHeaders(LANGUAGE_HEADERS);
	await page.setUserAgent(USER_AGENT);
	// So captures don't depend on the browser's default appearance
	await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);

	await page.setRequestInterception(true);
	page.on('request', (request: HTTPRequest) => {
		// The top-level document and its redirects, not an iframe's
		const isPage = request.isNavigationRequest() && request.frame() === page.mainFrame();
		if (blocksRequest(request.url(), request.resourceType(), isPage)) request.abort();
		else request.continue();
	});
}

async function takeScreenshot(page: Page, itemId: string): Promise<Upload> {
	await page.waitForNetworkIdle({ idleTime: 500, timeout: NETWORKIDLE_TIMEOUT }).catch(() => {});
	await new Promise((resolve) => setTimeout(resolve, SETTLE_DELAY));
	await page.addStyleTag({ content: `*::-webkit-scrollbar { display: none !important; }` });
	return {
		imageKey: `screenshots/${itemId}-${Date.now()}.webp`,
		body: await page.screenshot({ type: 'webp', quality: 85, fullPage: false }),
		contentType: 'image/webp',
		width: VIEWPORT_WIDTH,
		height: VIEWPORT_HEIGHT
	};
}

// The page's own og:image in og mode (skipping one the fast path already
// rejected), otherwise a viewport screenshot
async function captureInBrowser(
	env: Env,
	{ url, itemId, mode }: Required<ScreenshotRequest>,
	rejectedOgImage: string | undefined
): Promise<Response> {
	let browser: Browser | null = null;
	// Browser Rendering limits only show up while getting a browser and page
	let acquiringBrowser = true;

	try {
		const startTime = Date.now();
		browser = await puppeteer.launch(env.BROWSER);
		const page = await browser.newPage();
		acquiringBrowser = false;
		await preparePage(page);

		// Only the load itself must succeed; network idle is waited for below
		await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT });

		// Meta tags live in the initial HTML, so read them right away
		const meta = await page.evaluate(() => {
			const read = (selector: string) =>
				document.querySelector(selector)?.getAttribute('content')?.replace(/\s+/g, ' ').trim() ||
				null;
			const rawOgImage =
				read('meta[property="og:image"]') ??
				read('meta[name="twitter:image"]') ??
				read('meta[property="twitter:image"]');
			// baseURI honors redirects and <base href>
			let ogImage: string | null = null;
			if (rawOgImage) {
				try {
					ogImage = new URL(rawOgImage, document.baseURI).href;
				} catch {
					ogImage = null;
				}
			}
			return {
				ogImage,
				// For pages that only set <title> from JS, which the og path doesn't wait for
				ogTitle: read('meta[property="og:title"]') ?? read('meta[name="twitter:title"]'),
				description: read('meta[property="og:description"]') ?? read('meta[name="description"]')
			};
		});

		const ogImage =
			mode === 'og' && meta.ogImage && meta.ogImage !== rejectedOgImage
				? await fetchOgImage(meta.ogImage, page.url(), itemId)
				: null;
		const upload = ogImage ?? (await takeScreenshot(page, itemId));
		const title = (await page.title()).trim() || (ogImage ? meta.ogTitle : null);
		const fonts = await readFonts(page);

		// Closed before the upload, so that doesn't bill as browser time
		await browser.close().catch(() => {});
		browser = null;

		return Response.json({
			...(await store(env, upload)),
			captureTimeMs: Date.now() - startTime,
			title: title || undefined,
			description: meta.description ?? undefined,
			// On the og path a client-rendered page may have no text yet, and an
			// empty list would replace fonts an earlier screenshot found
			fonts: ogImage && !fonts?.length ? undefined : fonts
		} satisfies ScreenshotResponse);
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		const { status, error: userMessage } = classifyError(message, acquiringBrowser);
		console.error(
			`capture failed for ${url} (${status} ${userMessage}):`,
			error instanceof Error ? (error.stack ?? message) : error
		);
		return Response.json({ error: userMessage }, { status });
	} finally {
		// A crashed browser throws on close, which would replace the response
		await browser?.close().catch(() => {});
	}
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		if (request.method !== 'POST') {
			return Response.json({ error: 'Method not allowed' }, { status: 405 });
		}
		if (!(await isAuthorized(request.headers.get('Authorization'), env.API_KEY))) {
			return Response.json({ error: 'Unauthorized' }, { status: 401 });
		}

		let body: ScreenshotRequest;
		try {
			body = await request.json();
		} catch {
			return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
		}

		const { url, itemId } = body;
		const mode = body.mode === 'og' ? 'og' : 'screenshot';
		if (!url || !itemId) {
			return Response.json({ error: 'Missing url or itemId' }, { status: 400 });
		}
		if (!isValidUrl(url)) {
			return Response.json({ error: 'Invalid or blocked URL' }, { status: 400 });
		}

		// og mode tries a plain fetch first, spending no browser time; the browser
		// takes over on no og:image, a bot-blocked fetch or an unusable image
		let rejectedOgImage: string | undefined;
		if (mode === 'og') {
			const { result, rejectedImage } = await tryOgFast(env, url, itemId);
			if (result) return Response.json(result);
			rejectedOgImage = rejectedImage;
		}

		return captureInBrowser(env, { url, itemId, mode }, rejectedOgImage);
	}
};
