import puppeteer, { type Browser, type HTTPRequest } from '@cloudflare/puppeteer';
import { imageSize } from 'image-size';

// Minimal DOM globals for code running inside page.evaluate — the worker
// tsconfig has no DOM lib, and these only exist in the browser context.
declare const document: {
	querySelector(selector: string): { getAttribute(name: string): string | null } | null;
	baseURI: string;
};
declare const Image: new () => {
	naturalWidth: number;
	naturalHeight: number;
	onload: (() => void) | null;
	onerror: (() => void) | null;
	src: string;
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
}

interface ErrorResponse {
	error: string;
}

// Viewport settings
const VIEWPORT_WIDTH = 1440;
const VIEWPORT_HEIGHT = 900;
const NAVIGATION_TIMEOUT = 15000; // 15 seconds for initial navigation
const NETWORKIDLE_TIMEOUT = 10000; // 10 seconds to wait for network idle
const FALLBACK_DELAY = 2000; // 2 seconds extra wait if network doesn't idle
const FORCED_DELAY = 5000; // forced wait before screenshot (for loading screens, client-side rendering)

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

const USER_AGENT =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Validate URL is safe to screenshot
function isValidUrl(url: string): boolean {
	try {
		const parsed = new URL(url);

		// Only allow http/https
		if (!['http:', 'https:'].includes(parsed.protocol)) {
			return false;
		}

		// Block localhost and private IPs
		const hostname = parsed.hostname.toLowerCase();
		if (
			hostname === 'localhost' ||
			hostname === '127.0.0.1' ||
			hostname.startsWith('192.168.') ||
			hostname.startsWith('10.') ||
			hostname.startsWith('172.16.') ||
			hostname.endsWith('.local')
		) {
			return false;
		}

		return true;
	} catch {
		return false;
	}
}

// Generate a unique R2 key for a captured image
function generateImageKey(itemId: string, prefix: string, ext: string): string {
	const timestamp = Date.now();
	return `${prefix}/${itemId}-${timestamp}.${ext}`;
}

// Download the page's og:image (already resolved to an absolute URL) and store
// it in R2. Returns null whenever the image is unusable (too small, unfetchable,
// weird content type) so the caller can fall back to a screenshot.
async function tryOgImage(
	page: Awaited<ReturnType<Browser['newPage']>>,
	env: Env,
	pageUrl: string,
	itemId: string,
	imageUrl: string
): Promise<{ imageKey: string; width: number; height: number } | null> {
	try {
		// Measure in the browser: format-agnostic and reuses the page's cookies/referer
		const dims = await page.evaluate((src: string) => {
			return new Promise<{ width: number; height: number } | null>((resolve) => {
				const img = new Image();
				const timer = setTimeout(() => resolve(null), 10000);
				img.onload = () => {
					clearTimeout(timer);
					resolve({ width: img.naturalWidth, height: img.naturalHeight });
				};
				img.onerror = () => {
					clearTimeout(timer);
					resolve(null);
				};
				img.src = src;
			});
		}, imageUrl);
		if (!dims || dims.width < MIN_OG_WIDTH || dims.height < 1) {
			console.log(`og:image rejected (dims: ${JSON.stringify(dims)})`);
			return null;
		}

		const response = await fetch(imageUrl, {
			headers: { 'User-Agent': USER_AGENT, Referer: pageUrl },
			signal: AbortSignal.timeout(OG_FETCH_TIMEOUT)
		});
		if (!response.ok) return null;

		const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
		const ext = contentType ? OG_CONTENT_TYPE_EXT[contentType] : undefined;
		if (!contentType || !ext) return null;

		const buffer = await response.arrayBuffer();
		const imageKey = generateImageKey(itemId, 'og', ext);
		await env.R2_BUCKET.put(imageKey, buffer, {
			httpMetadata: {
				contentType,
				cacheControl: 'public, max-age=31536000, immutable'
			}
		});

		return { imageKey, width: dims.width, height: dims.height };
	} catch (error) {
		console.log('og:image fetch failed:', error instanceof Error ? error.message : error);
		return null;
	}
}

// Fast og path: fetch the page HTML directly and extract the og:image without
// launching a browser (Browser Rendering free plan allows only ~10 min/day and
// 1 launch per 20s). Returns null on any failure so the caller can fall back
// to the full browser flow.
async function tryOgFast(env: Env, url: string, itemId: string): Promise<ScreenshotResponse | null> {
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
		if (!pageResponse.ok) return null;
		const pageType = pageResponse.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
		if (pageType !== 'text/html' && pageType !== 'application/xhtml+xml') return null;

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
		const rewriter = new HTMLRewriter()
			.on('meta', {
				element(el) {
					const content = el.getAttribute('content')?.trim();
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
					meta.baseHref ??= el.getAttribute('href');
				}
			})
			.on('head > title', {
				text(t) {
					meta.pageTitle += t.text;
				}
			});
		// Handlers only run as the transformed body is consumed
		await rewriter.transform(pageResponse).arrayBuffer();

		const rawImage = meta.ogImage ?? meta.twitterImage;
		if (!rawImage) return null;

		// Resolve relative URLs against <base href> or the final (post-redirect) URL
		const pageUrl = pageResponse.url || url;
		const base = meta.baseHref ? new URL(meta.baseHref, pageUrl).href : pageUrl;
		const imageUrl = new URL(rawImage, base).href;

		const imageResponse = await fetch(imageUrl, {
			headers: { 'User-Agent': USER_AGENT, Referer: pageUrl },
			signal: AbortSignal.timeout(OG_FETCH_TIMEOUT)
		});
		if (!imageResponse.ok) return null;

		const contentType = imageResponse.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
		const ext = contentType ? OG_CONTENT_TYPE_EXT[contentType] : undefined;
		if (!contentType || !ext) return null;

		const buffer = await imageResponse.arrayBuffer();
		const dims = imageSize(new Uint8Array(buffer));
		if (!dims.width || !dims.height || dims.width < MIN_OG_WIDTH) {
			console.log(`og:image rejected (dims: ${dims.width}x${dims.height})`);
			return null;
		}

		const imageKey = generateImageKey(itemId, 'og', ext);
		await env.R2_BUCKET.put(imageKey, buffer, {
			httpMetadata: {
				contentType,
				cacheControl: 'public, max-age=31536000, immutable'
			}
		});

		const title = meta.pageTitle.trim() || meta.ogTitle || meta.twitterTitle;
		return {
			imageKey,
			width: dims.width,
			height: dims.height,
			captureTimeMs: Date.now() - startTime,
			title: title || undefined,
			description: meta.ogDescription ?? meta.description ?? undefined
		};
	} catch (error) {
		console.log('fast og fetch failed:', error instanceof Error ? error.message : error);
		return null;
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
		const authHeader = request.headers.get('Authorization');
		if (!env.API_KEY || !authHeader || authHeader !== `Bearer ${env.API_KEY}`) {
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
		if (mode === 'og') {
			const fast = await tryOgFast(env, url, itemId);
			if (fast) {
				console.log(`[${Date.now()}] og:image stored without browser in ${fast.captureTimeMs}ms`);
				return new Response(JSON.stringify(fast), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				});
			}
			console.log(`[${Date.now()}] fast og path failed, falling back to browser`);
		}

		let browser: Browser | null = null;

		try {
			const startTime = Date.now();
			console.log(`[${startTime}] Starting screenshot for URL:`, url);

			// Launch browser
			console.log(`[${Date.now()}] Launching browser...`);
			browser = await puppeteer.launch(env.BROWSER);
			console.log(`[${Date.now()}] Browser launched`);

			const page = await browser.newPage();
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

			// Enable request interception to block tracking/analytics
			await page.setRequestInterception(true);
			page.on('request', (request: HTTPRequest) => {
				const url = request.url();
				const resourceType = request.resourceType();

				// Never block the page itself (e.g. screenshotting an analytics vendor's own site)
				if (request.isNavigationRequest() || resourceType === 'document') {
					request.continue();
					return;
				}

				// Block tracking, analytics, and ads that prevent network idle
				if (
					// Analytics & tracking services
					url.includes('google-analytics.com') ||
					url.includes('googletagmanager.com') ||
					url.includes('facebook.com/tr') ||
					url.includes('doubleclick.net') ||
					url.includes('analytics') ||
					url.includes('hotjar') ||
					url.includes('segment.') ||
					url.includes('mixpanel') ||
					// Ad networks
					url.includes('googlesyndication.com') ||
					url.includes('adservice') ||
					url.includes('adsystem') ||
					url.includes('advertising') ||
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
					document.querySelector(selector)?.getAttribute('content')?.trim() || null;
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
			if (mode === 'og' && meta.ogImage) {
				const ogResult = await tryOgImage(page, env, page.url(), itemId, meta.ogImage);
				if (ogResult) {
					const captureTimeMs = Date.now() - startTime;
					console.log(`[${Date.now()}] og:image stored in ${captureTimeMs}ms`);
					const title = (await page.title()).trim() || meta.ogTitle;
					const response: ScreenshotResponse = {
						...ogResult,
						captureTimeMs,
						title: title || undefined,
						description: meta.description ?? undefined
					};
					return new Response(JSON.stringify(response), {
						status: 200,
						headers: { 'Content-Type': 'application/json' }
					});
				}
				console.log(`[${Date.now()}] og:image unusable, falling back to screenshot`);
			}

			// Try to wait for network idle, but take screenshot anyway if it times out
			try {
				await page.waitForNetworkIdle({
					idleTime: 500,
					timeout: NETWORKIDLE_TIMEOUT
				});
				console.log(`[${Date.now()}] Network idle achieved`);
			} catch {
				// Network didn't fully idle - wait a bit more and proceed anyway
				console.log(`[${Date.now()}] Network idle timeout, proceeding with screenshot after delay`);
				await new Promise((resolve) => setTimeout(resolve, FALLBACK_DELAY));
			}

			// Always wait a bit more to allow for loading screens and client-side rendering
			console.log(`[${Date.now()}] Waiting for loading screens to complete...`);
			await new Promise((resolve) => setTimeout(resolve, FORCED_DELAY));

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
				description: meta.description ?? undefined
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

			// Categorize errors for better handling
			let statusCode = 500;
			let userMessage = 'Failed to capture screenshot';

			if (errorMessage.includes('net::ERR_NAME_NOT_RESOLVED')) {
				statusCode = 502;
				userMessage = 'Domain not found';
			} else if (errorMessage.includes('net::ERR_CONNECTION_REFUSED')) {
				statusCode = 502;
				userMessage = 'Connection refused';
			} else if (errorMessage.includes('timeout') || errorMessage.includes('Timeout')) {
				statusCode = 504;
				userMessage = 'Page load timeout';
			} else if (errorMessage.includes('net::ERR_') || errorMessage.includes('Navigation')) {
				statusCode = 502;
				userMessage = 'Failed to load page';
			}

			const errorResponse: ErrorResponse = {
				error: userMessage
			};

			return new Response(JSON.stringify(errorResponse), {
				status: statusCode,
				headers: { 'Content-Type': 'application/json' }
			});
		} finally {
			if (browser) {
				await browser.close();
			}
		}
	}
};
