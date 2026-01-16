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
}

interface ErrorResponse {
	error: string;
}

// Viewport settings
const VIEWPORT_WIDTH = 1200;
const VIEWPORT_HEIGHT = 800;
const SCREENSHOT_TIMEOUT = 30000; // 30 seconds

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
			console.log('Starting screenshot for URL:', url);

			// Launch browser
			console.log('Launching browser...');
			browser = await puppeteer.launch(env.BROWSER);
			console.log('Browser launched');

			const page = await browser.newPage();
			console.log('New page created');

			// Set viewport
			await page.setViewport({
				width: VIEWPORT_WIDTH,
				height: VIEWPORT_HEIGHT
			});

			// Navigate to URL with timeout
			await page.goto(url, {
				waitUntil: 'networkidle0',
				timeout: SCREENSHOT_TIMEOUT
			});

			// Take screenshot as WebP
			const screenshotBuffer = await page.screenshot({
				type: 'webp',
				quality: 85,
				fullPage: false
			});

			// Generate unique key for R2
			const imageKey = generateImageKey(itemId);

			// Upload to R2
			await env.R2_BUCKET.put(imageKey, screenshotBuffer, {
				httpMetadata: {
					contentType: 'image/webp'
				}
			});

			// Return success response
			const response: ScreenshotResponse = {
				imageKey,
				width: VIEWPORT_WIDTH,
				height: VIEWPORT_HEIGHT
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

			if (errorMessage.includes('timeout') || errorMessage.includes('Timeout')) {
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
