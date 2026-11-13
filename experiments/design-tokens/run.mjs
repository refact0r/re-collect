// Throwaway runner: loads each URL the way workers/screenshot does (same
// viewport, UA, tracker blocking, waits), runs extract.js, and records timing
// plus Chromium's ground truth for which fonts actually rendered.
//   node run.mjs urls.txt [concurrency]
import puppeteer from 'puppeteer-core';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const UA =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const BLOCK = /google-analytics\.com|googletagmanager\.com|facebook\.com\/tr|doubleclick\.net|analytics|hotjar|segment\.|mixpanel|googlesyndication\.com|adservice|adsystem|advertising/;

const [, , listFile = 'urls.txt', conc = '4'] = process.argv;
const urls = (await readFile(listFile, 'utf8')).split('\n').map((s) => s.trim()).filter((s) => s && !s.startsWith('#'));
const extractSrc = await readFile(new URL('./extract.js', import.meta.url), 'utf8');
await mkdir('out', { recursive: true });

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--hide-scrollbars'] });

async function groundTruth(page) {
	const cdp = await page.createCDPSession();
	await cdp.send('DOM.enable');
	await cdp.send('CSS.enable');
	const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
	const out = {};
	// Internal (name-table) family of each extracted font, via one marked element per family
	for (let i = 0; i < 6; i++) {
		const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: `[data-dt-font="${i}"]` });
		if (!nodeId) continue;
		try {
			const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
			out[i] = fonts.map((f) => `${f.familyName}${f.isCustomFont ? '*' : ''}(${f.glyphCount})`).join(', ');
		} catch {
			// node gone
		}
	}
	await cdp.detach();
	return out;
}

async function run(url) {
	const page = await browser.newPage();
	const res = { url };
	const t0 = Date.now();
	try {
		await page.setViewport({ width: 1440, height: 900 });
		await page.setUserAgent(UA);
		// Pin light mode: headless Chrome otherwise inherits the OS appearance
		await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
		await page.setRequestInterception(true);
		page.on('request', (r) => {
			if (r.isNavigationRequest()) return r.continue();
			if (BLOCK.test(r.url()) || ['ping', 'websocket'].includes(r.resourceType())) return r.abort();
			r.continue();
		});
		await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
		res.domMs = Date.now() - t0;
		await page.waitForNetworkIdle({ idleTime: 500, timeout: 10000 }).catch(() => {});
		await new Promise((r) => setTimeout(r, 3000));
		res.loadMs = Date.now() - t0;

		const t1 = Date.now();
		res.tokens = await page.evaluate(`(${extractSrc.slice(extractSrc.indexOf('async function'))})()`);
		res.extractMs = Date.now() - t1;

		const t2 = Date.now();
		res.truth = await groundTruth(page);
		res.truthMs = Date.now() - t2;

		await page.screenshot({ path: `out/${new URL(url).hostname}.jpg`, type: 'jpeg', quality: 60 });

		// Does the page actually change under prefers-color-scheme: dark?
		const t3 = Date.now();
		const probe = () =>
			page.evaluate(() => {
				const pick = (el) => getComputedStyle(el).backgroundColor;
				const pts = [[720, 450], [200, 200], [1200, 700]].map(([x, y]) => {
					let el = document.elementFromPoint(x, y);
					while (el && /rgba\(0, 0, 0, 0\)|transparent/.test(pick(el))) el = el.parentElement;
					return el ? pick(el) : 'none';
				});
				return pts.join(' | ') + ' / ' + getComputedStyle(document.body).color;
			});
		const light = await probe();
		await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
		await new Promise((r) => setTimeout(r, 400));
		const dark = await probe();
		res.darkProbe = { changed: light !== dark, light, dark, ms: Date.now() - t3 };
	} catch (e) {
		res.error = e.message.split('\n')[0];
	} finally {
		res.totalMs = Date.now() - t0;
		await page.close().catch(() => {});
	}
	console.log(`${res.error ? 'ERR' : 'ok '} ${res.totalMs}ms extract=${res.extractMs}ms ${url}${res.error ? ' ' + res.error : ''}`);
	return res;
}

const results = [];
const queue = [...urls];
await Promise.all(
	Array.from({ length: +conc }, async () => {
		while (queue.length) results.push(await run(queue.shift()));
	})
);
await browser.close();
results.sort((a, b) => urls.indexOf(a.url) - urls.indexOf(b.url));
await writeFile('out/results.json', JSON.stringify(results, null, 1));
