import puppeteer from '@cloudflare/puppeteer';

interface Env {
	BROWSER: Fetcher;
	R2_BUCKET: R2Bucket;
	API_KEY: string;
}

interface ScreenshotRequest {
	url: string;
	itemId: string;
}

interface ScreenshotResponse {
	imageKey: string;
	width: number;
	height: number;
	captureTimeMs: number;
	title?: string;
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

// Generate a unique key for the screenshot
function generateImageKey(itemId: string): string {
	const timestamp = Date.now();
	return `screenshots/${itemId}-${timestamp}.webp`;
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
		if (!authHeader || authHeader !== `Bearer ${env.API_KEY}`) {
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

		let browser: puppeteer.Browser | null = null;

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
			await page.setUserAgent(
				'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
			);

			// Enable request interception to block tracking/analytics
			await page.setRequestInterception(true);
			page.on('request', (request) => {
				const url = request.url();
				const resourceType = request.resourceType();

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
					// Resource types that keep network busy
					resourceType === 'beacon' ||
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

			// Try to wait for network idle, but take screenshot anyway if it times out
			try {
				await page.waitForNetworkIdle({
					idleTime: 500,
					timeout: NETWORKIDLE_TIMEOUT
				});
				console.log(`[${Date.now()}] Network idle achieved`);
			} catch (e) {
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
			const imageKey = generateImageKey(itemId);

			// Upload to R2
			await env.R2_BUCKET.put(imageKey, screenshotBuffer, {
				httpMetadata: {
					contentType: 'image/webp'
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
				title: title.trim() || undefined // Only include if non-empty
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
