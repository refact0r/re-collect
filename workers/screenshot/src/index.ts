import puppeteer, { type Browser, type HTTPRequest } from '@cloudflare/puppeteer';
import { imageSize } from 'image-size';
import { readFonts, type SiteFont } from './fonts.js';
import {
	classifyError,
	collapseWhitespace,
	decodeEntities,
	isTrackerRequest,
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

interface ErrorResponse {
	error: string;
}

// Viewport settings
const VIEWPORT_WIDTH = 1440;
const VIEWPORT_HEIGHT = 900;

// Capture timing
const NAVIGATION_TIMEOUT = 10000; // initial navigation (domcontentloaded)
const NETWORKIDLE_TIMEOUT = 10000; // wait for network idle after navigation
const SETTLE_DELAY = 5000; // wait after network idle for loading animations / client-side rendering

// og:image handling
const MIN_OG_WIDTH = 400; // reject tiny og:images (logos, favicons) and fall back to screenshot
const OG_FETCH_TIMEOUT = 10000;
const OG_CONTENT_TYPE_EXT: Record<string, string> = {
	'image/jpeg': 'jpg',
	'image/png': 'png',
	'image/webp': 'webp',
	'image/gif': 'gif',
	'image/avif': 'avif'
};
// Some CDNs serve images untyped; those are kept when the bytes sniff as one
const OCTET_STREAM = ['application/octet-stream', 'binary/octet-stream'];
// image-size's names for the types above
const SNIFFED_TYPES: Record<string, string> = {
	jpg: 'image/jpeg',
	png: 'image/png',
	webp: 'image/webp',
	gif: 'image/gif',
	avif: 'image/avif'
};
const MAX_OG_BYTES = 20 * 1024 * 1024;

const USER_AGENT =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Generate a unique R2 key for a captured image
function generateImageKey(itemId: string, prefix: string, ext: string): string {
	const timestamp = Date.now();
	return `${prefix}/${itemId}-${timestamp}.${ext}`;
}

// Download an og:image (an absolute URL) and store it in R2. Returns null
// whenever the image is unusable (too small or large, unfetchable, not a raster
// image) so the caller can fall back to a screenshot.
async function storeOgImage(
	env: Env,
	imageUrl: string,
	pageUrl: string,
	itemId: string
): Promise<{ imageKey: string; width: number; height: number } | null> {
	try {
		const response = await fetch(imageUrl, {
			headers: { 'User-Agent': USER_AGENT, Referer: pageUrl },
			signal: AbortSignal.timeout(OG_FETCH_TIMEOUT)
		});
		if (!response.ok) return null;
		const declared = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? '';
		if (!OG_CONTENT_TYPE_EXT[declared] && !OCTET_STREAM.includes(declared)) return null;
		if (Number(response.headers.get('content-length')) > MAX_OG_BYTES) return null;

		const buffer = await response.arrayBuffer();
		if (buffer.byteLength > MAX_OG_BYTES) return null;
		// Stored as the type the bytes are, whatever the server called them
		const dims = imageSize(new Uint8Array(buffer));
		const contentType = dims.type ? SNIFFED_TYPES[dims.type] : undefined;
		// EXIF orientations 5-8 are turned a quarter, so browsers show them on their side
		const [width, height] =
			(dims.orientation ?? 1) >= 5 ? [dims.height, dims.width] : [dims.width, dims.height];
		if (!contentType || !width || !height || width < MIN_OG_WIDTH) {
			console.log(`og:image rejected (${dims.type} ${width}x${height})`);
			return null;
		}

		const imageKey = generateImageKey(itemId, 'og', OG_CONTENT_TYPE_EXT[contentType]);
		await env.R2_BUCKET.put(imageKey, buffer, {
			httpMetadata: {
				contentType,
				cacheControl: 'public, max-age=31536000, immutable'
			}
		});
		return { imageKey, width, height };
	} catch (error) {
		console.log('og:image fetch failed:', error instanceof Error ? error.message : error);
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
			headers: {
				'User-Agent': USER_AGENT,
				'Accept-Language': 'en-US,en;q=0.9',
				Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
			},
			signal: AbortSignal.timeout(OG_FETCH_TIMEOUT)
		});
		if (!pageResponse.ok) return {};
		const pageType = pageResponse.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
		if (pageType !== 'text/html' && pageType !== 'application/xhtml+xml') return {};

		const meta = {
			ogImage: null as string | null,
			twitterImage: null as string | null,
			ogTitle: null as string | null,
			twitterTitle: null as string | null,
			ogDescription: null as string | null,
			description: null as string | null,
			pageTitle: '',
			baseHref: null as string | null
		};
		let titles = 0;
		const rewriter = new HTMLRewriter()
			.on('meta', {
				element(el) {
					const content = collapseWhitespace(decodeEntities(el.getAttribute('content') ?? ''));
					if (!content) return;
					const key = (el.getAttribute('property') ?? el.getAttribute('name'))?.toLowerCase();
					if (key === 'og:image') meta.ogImage ??= content;
					else if (key === 'twitter:image') meta.twitterImage ??= content;
					else if (key === 'og:title') meta.ogTitle ??= content;
					else if (key === 'twitter:title') meta.twitterTitle ??= content;
					else if (key === 'og:description') meta.ogDescription ??= content;
					else if (key === 'description') meta.description ??= content;
				}
			})
			.on('base', {
				element(el) {
					const href = el.getAttribute('href');
					if (href) meta.baseHref ??= decodeEntities(href);
				}
			})
			// Not "head > title": <head> is optional. Only the first <title> is the
			// document's; later ones belong to inline SVGs.
			.on('title', {
				element() {
					titles++;
				},
				text(t) {
					if (titles === 1) meta.pageTitle += t.text;
				}
			});
		// Handlers only run as the transformed body is consumed
		await rewriter.transform(pageResponse).arrayBuffer();

		const rawImage = meta.ogImage ?? meta.twitterImage;
		if (!rawImage) return {};

		// Resolve relative URLs against <base href> or the final (post-redirect) URL
		const pageUrl = pageResponse.url || url;
		const base = meta.baseHref ? new URL(meta.baseHref, pageUrl).href : pageUrl;
		const imageUrl = new URL(rawImage, base).href;

		const image = await storeOgImage(env, imageUrl, pageUrl, itemId);
		if (!image) return { rejectedImage: imageUrl };

		// Decoded once the chunks are joined, since an entity can span two chunks
		const title =
			collapseWhitespace(decodeEntities(meta.pageTitle)) || meta.ogTitle || meta.twitterTitle;
		return {
			result: {
				...image,
				captureTimeMs: Date.now() - startTime,
				title: title || undefined,
				description: meta.ogDescription ?? meta.description ?? undefined
			}
		};
	} catch (error) {
		console.log('fast og fetch failed:', error instanceof Error ? error.message : error);
		return {};
	}
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		// Only allow POST requests
		if (request.method !== 'POST') {
			return new Response(JSON.stringify({ error: 'Method not allowed' }), {
				status: 405,
				headers: { 'Content-Type': 'application/json' }
			});
		}

		// Validate API key
		if (!(await isAuthorized(request.headers.get('Authorization'), env.API_KEY))) {
			return new Response(JSON.stringify({ error: 'Unauthorized' }), {
				status: 401,
				headers: { 'Content-Type': 'application/json' }
			});
		}

		let body: ScreenshotRequest;
		try {
			body = await request.json();
		} catch {
			return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
				status: 400,
				headers: { 'Content-Type': 'application/json' }
			});
		}

		const { url, itemId } = body;
		const mode = body.mode === 'og' ? 'og' : 'screenshot';

		if (!url || !itemId) {
			return new Response(JSON.stringify({ error: 'Missing url or itemId' }), {
				status: 400,
				headers: { 'Content-Type': 'application/json' }
			});
		}

		// Validate URL
		if (!isValidUrl(url)) {
			return new Response(JSON.stringify({ error: 'Invalid or blocked URL' }), {
				status: 400,
				headers: { 'Content-Type': 'application/json' }
			});
		}

		// og mode: try extracting the og:image with a plain fetch first — no
		// browser time spent. Fall through to the browser flow if it fails
		// (no og:image, bot-blocked fetch, unusable image).
		let rejectedOgImage: string | undefined;
		if (mode === 'og') {
			const { result, rejectedImage } = await tryOgFast(env, url, itemId);
			if (result) {
				console.log(`[${Date.now()}] og:image stored without browser in ${result.captureTimeMs}ms`);
				return new Response(JSON.stringify(result), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				});
			}
			console.log(`[${Date.now()}] fast og path failed, falling back to browser`);
			rejectedOgImage = rejectedImage;
		}

		let browser: Browser | null = null;
		// Browser Rendering limits only show up while getting a browser and page
		let acquiringBrowser = true;

		try {
			const startTime = Date.now();
			console.log(`[${startTime}] Starting screenshot for URL:`, url);

			// Launch browser
			console.log(`[${Date.now()}] Launching browser...`);
			browser = await puppeteer.launch(env.BROWSER);
			console.log(`[${Date.now()}] Browser launched`);

			const page = await browser.newPage();
			acquiringBrowser = false;
			console.log(`[${Date.now()}] New page created`);

			// Set viewport
			await page.setViewport({
				width: VIEWPORT_WIDTH,
				height: VIEWPORT_HEIGHT
			});

			// Set headers to appear more like a real browser
			await page.setExtraHTTPHeaders({
				'Accept-Language': 'en-US,en;q=0.9',
				Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
				'Accept-Encoding': 'gzip, deflate, br'
			});

			// Set a realistic user agent
			await page.setUserAgent(USER_AGENT);

			// Pin light mode so captures don't depend on the browser's default appearance
			await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);

			// Enable request interception to block tracking/analytics
			await page.setRequestInterception(true);
			page.on('request', (request: HTTPRequest) => {
				const resourceType = request.resourceType();

				// Never block the page itself (e.g. screenshotting an analytics vendor's own site)
				if (request.isNavigationRequest() || resourceType === 'document') {
					request.continue();
					return;
				}

				// Block tracking, analytics, and ads that prevent network idle
				if (
					isTrackerRequest(request.url()) ||
					// Resource types that keep network busy ('ping' covers beacons)
					resourceType === 'ping' ||
					resourceType === 'websocket'
				) {
					request.abort();
				} else {
					request.continue();
				}
			});

			// Navigate to URL - two phase approach:
			// 1. First ensure the page loads (domcontentloaded)
			// 2. Then try to wait for network idle, but don't fail if it times out
			console.log(`[${Date.now()}] Navigating to URL...`);
			await page.goto(url, {
				waitUntil: 'domcontentloaded',
				timeout: NAVIGATION_TIMEOUT
			});
			console.log(`[${Date.now()}] DOM content loaded`);

			// Meta tags live in the initial HTML, so read them right away
			const meta = await page.evaluate(() => {
				const read = (selector: string) =>
					document.querySelector(selector)?.getAttribute('content')?.replace(/\s+/g, ' ').trim() ||
					null;
				const rawOgImage =
					read('meta[property="og:image"]') ??
					read('meta[name="twitter:image"]') ??
					read('meta[property="twitter:image"]');
				// Resolve relative values against baseURI so redirects and <base href>
				// are honored (the originally requested URL may not be where we landed)
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
					// Fallback title for pages that only set <title> via JS after load —
					// og mode reads the title at domcontentloaded, before scripts settle
					ogTitle: read('meta[property="og:title"]') ?? read('meta[name="twitter:title"]'),
					description: read('meta[property="og:description"]') ?? read('meta[name="description"]')
				};
			});

			// og mode: use the page's own preview image when it's usable
			// (skipping the one the fast path already fetched and rejected)
			if (mode === 'og' && meta.ogImage && meta.ogImage !== rejectedOgImage) {
				const ogResult = await storeOgImage(env, meta.ogImage, page.url(), itemId);
				if (ogResult) {
					const title = (await page.title()).trim() || meta.ogTitle;
					// Read this early, a client-rendered page may have no text yet: an
					// empty list would replace fonts an earlier screenshot found
					const fonts = await readFonts(page);
					const captureTimeMs = Date.now() - startTime;
					console.log(`[${Date.now()}] og:image stored in ${captureTimeMs}ms`);
					const response: ScreenshotResponse = {
						...ogResult,
						captureTimeMs,
						title: title || undefined,
						description: meta.description ?? undefined,
						fonts: fonts?.length ? fonts : undefined
					};
					return new Response(JSON.stringify(response), {
						status: 200,
						headers: { 'Content-Type': 'application/json' }
					});
				}
				console.log(`[${Date.now()}] og:image unusable, falling back to screenshot`);
			}

			// Try to wait for network idle, but take the screenshot anyway if it times out
			try {
				await page.waitForNetworkIdle({
					idleTime: 500,
					timeout: NETWORKIDLE_TIMEOUT
				});
				console.log(`[${Date.now()}] Network idle achieved`);
			} catch {
				console.log(`[${Date.now()}] Network idle timeout, proceeding with screenshot`);
			}

			// Settle for loading animations and client-side rendering
			await new Promise((resolve) => setTimeout(resolve, SETTLE_DELAY));

			// Hide scrollbars for cleaner screenshots
			await page.addStyleTag({
				content: `*::-webkit-scrollbar { display: none !important; }`
			});

			console.log(`[${Date.now()}] Taking screenshot`);

			// Take screenshot as WebP
			const screenshotBuffer = await page.screenshot({
				type: 'webp',
				quality: 85,
				fullPage: false
			});

			// Extract page title
			const title = await page.title();

			const fonts = await readFonts(page);

			// Browser work is done - close it now so the R2 upload doesn't bill
			// as browser time
			await browser.close().catch(() => {});
			browser = null;

			// Generate unique key for R2
			const imageKey = generateImageKey(itemId, 'screenshots', 'webp');

			// Upload to R2
			await env.R2_BUCKET.put(imageKey, screenshotBuffer, {
				httpMetadata: {
					contentType: 'image/webp',
					cacheControl: 'public, max-age=31536000, immutable'
				}
			});

			// Return success response
			const captureTimeMs = Date.now() - startTime;
			console.log(`[${Date.now()}] Screenshot complete in ${captureTimeMs}ms`);

			const response: ScreenshotResponse = {
				imageKey,
				width: VIEWPORT_WIDTH,
				height: VIEWPORT_HEIGHT,
				captureTimeMs,
				title: title.trim() || undefined, // Only include if non-empty
				description: meta.description ?? undefined,
				fonts
			};

			return new Response(JSON.stringify(response), {
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			});
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : 'Unknown error';
			console.error('Screenshot error:', errorMessage);
			if (error instanceof Error && error.stack) {
				console.error('Stack:', error.stack);
			}

			const { status, error: userMessage } = classifyError(errorMessage, acquiringBrowser);
			const errorResponse: ErrorResponse = {
				error: userMessage
			};

			return new Response(JSON.stringify(errorResponse), {
				status,
				headers: { 'Content-Type': 'application/json' }
			});
		} finally {
			// A crashed browser throws on close, which would replace the response
			if (browser) {
				await browser.close().catch(() => {});
			}
		}
	}
};
