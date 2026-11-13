// Runs the worker's real font code (workers/screenshot/src/fonts.ts) and the
// app's naming (src/convex/lib/fonts.ts) against live pages in local Chrome.
//   node check-worker.mjs urls.txt
import puppeteer from 'puppeteer-core';
import { readFile } from 'node:fs/promises';
import { readFonts } from '../../workers/screenshot/src/fonts.ts';
import { fontDisplayName, parseSiteFonts } from '../../src/convex/lib/fonts.ts';

const urls = (await readFile(process.argv[2] ?? 'urls.txt', 'utf8'))
	.split('\n')
	.map((s) => s.trim())
	.filter((s) => s && !s.startsWith('#'));
const browser = await puppeteer.launch({
	executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
	headless: true
});
const queue = [...urls];
await Promise.all(
	Array.from({ length: 5 }, async () => {
		while (queue.length) {
			const url = queue.shift();
			const page = await browser.newPage();
			try {
				await page.setViewport({ width: 1440, height: 900 });
				await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
				await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
				await page.waitForNetworkIdle({ idleTime: 500, timeout: 10000 }).catch(() => {});
				await new Promise((r) => setTimeout(r, 5000));
				const t0 = Date.now();
				const fonts = parseSiteFonts(await readFonts(page)) ?? [];
				const host = new URL(url).hostname.replace(/^www\./, '');
				console.log(
					`${host.padEnd(30)} ${String(Date.now() - t0).padStart(4)}ms  ` +
						fonts
							.map((f) => `${fontDisplayName(f)}${f.internalName ? '' : '°'}`)
							.join(' | ')
				);
			} catch (e) {
				console.log(`${url} ERROR ${e.message.split('\n')[0]}`);
			} finally {
				await page.close().catch(() => {});
			}
		}
	})
);
await browser.close();
