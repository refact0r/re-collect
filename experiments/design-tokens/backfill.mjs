// Backfills items.fonts by loading each URL item in local Chrome with the
// worker's real font code, so it costs no Browser Run quota. Writes through
// the screenshots:setFonts internal mutation; the image is left alone.
//   node backfill.mjs [--prod] [--all]   (--all also redoes items that have fonts)
import puppeteer from 'puppeteer-core';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { readFonts } from '../../workers/screenshot/src/fonts.ts';
import { fontDisplayName, parseSiteFonts } from '../../src/convex/lib/fonts.ts';

const prod = process.argv.includes('--prod');
const redoAll = process.argv.includes('--all');
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const convex = (...args) =>
	execFileSync('npx', ['convex', ...args, ...(prod ? ['--prod'] : [])], {
		cwd: repoRoot,
		encoding: 'utf8',
		maxBuffer: 1e8
	});

const items = convex('data', 'items', '--limit', '10000', '--format', 'jsonl')
	.split('\n')
	.filter(Boolean)
	.map((line) => JSON.parse(line))
	.filter((item) => item.type === 'url' && item.url && (redoAll || !item.fonts));
console.log(`${items.length} URL items to backfill on ${prod ? 'prod' : 'dev'}`);

// Same page setup as workers/screenshot
const browser = await puppeteer.launch({
	executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
	headless: true
});
const results = [];
const queue = [...items];
let done = 0;
await Promise.all(
	Array.from({ length: 4 }, async () => {
		while (queue.length) {
			const item = queue.shift();
			const page = await browser.newPage();
			let fonts;
			try {
				await page.setViewport({ width: 1440, height: 900 });
				await page.setUserAgent(
					'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
				);
				await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
				await page.goto(item.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
				await page.waitForNetworkIdle({ idleTime: 500, timeout: 10000 }).catch(() => {});
				await new Promise((r) => setTimeout(r, 5000));
				fonts = parseSiteFonts(await readFonts(page));
			} catch (e) {
				console.log(`  ${item.url}: ${e.message.split('\n')[0]}`);
			} finally {
				await page.close().catch(() => {});
			}
			done++;
			if (fonts?.length) results.push({ itemId: item._id, fonts });
			console.log(
				`[${done}/${items.length}] ${item.url}  ${fonts?.length ? fonts.map(fontDisplayName).join(' | ') : '(none)'}`
			);
		}
	})
);
await browser.close();

await writeFile(
	new URL(`out/backfill-${prod ? 'prod' : 'dev'}.json`, import.meta.url),
	JSON.stringify(results, null, '\t')
);
for (let i = 0; i < results.length; i += 20) {
	convex('run', 'screenshots:setFonts', JSON.stringify({ items: results.slice(i, i + 20) }));
}
console.log(`wrote fonts for ${results.length} of ${items.length} items`);
