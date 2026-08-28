// Cache article texts for the text-tagging model comparison.
// Mirrors extractArticleText() in src/convex/tagging.ts (same deps, same caps)
// so the cached input matches what production would send. Run once; the
// harness (compare_models.py) reads the cached .txt files so every model
// gets byte-identical input.
//
// Usage: node experiments/tagging/extract_articles.mjs

import { parseHTML } from 'linkedom';
import Defuddle from 'defuddle';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const FETCH_TIMEOUT_MS = 15_000;
const MAX_HTML_CHARS = 4_000_000;
const MAX_ARTICLE_CHARS = 8_000;
const MIN_ARTICLE_CHARS = 200;

const FETCH_HEADERS = {
	'User-Agent':
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
	'Accept-Language': 'en-US,en;q=0.9',
	Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
};

// 3 real text-tagged items from the dev deployment + 3 well-known articles
// picked for form diversity (personal essay, empirical analysis, talk).
const ARTICLES = [
	{ slug: 'olivine', url: 'https://worksinprogress.co/issue/olivine-weathering' },
	{ slug: 'syntax-highlighting', url: 'https://tonsky.me/blog/syntax-highlighting/' },
	{ slug: 'jpeg', url: 'https://www.sophielwang.com/blog/jpeg' },
	{ slug: 'greatwork', url: 'https://paulgraham.com/greatwork.html' },
	{ slug: 'keyboard-latency', url: 'https://danluu.com/keyboard-latency/' },
	{ slug: 'good-room', url: 'https://frankchimero.com/blog/2018/the-good-room/' }
];

async function extract(url) {
	const response = await fetch(url, {
		headers: FETCH_HEADERS,
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
	});
	if (!response.ok) throw new Error(`Page fetch failed: ${response.status}`);
	const html = (await response.text()).slice(0, MAX_HTML_CHARS);
	const { document } = parseHTML(html);
	const result = new Defuddle(document, { url: response.url || url }).parse();
	const { document: contentDoc } = parseHTML(`<html><body>${result.content}</body></html>`);
	const text = (contentDoc.body?.textContent ?? '').replace(/\s+/g, ' ').trim();
	if (text.length < MIN_ARTICLE_CHARS) throw new Error('Could not extract article text');
	return { title: result.title || undefined, text: text.slice(0, MAX_ARTICLE_CHARS) };
}

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'articles');
mkdirSync(outDir, { recursive: true });

const manifest = [];
for (const { slug, url } of ARTICLES) {
	try {
		const { title, text } = await extract(url);
		// Same input framing as tagTextItem in tagging.ts
		const input = [title ? `Title: ${title}` : null, `URL: ${url}`, '', text]
			.filter((l) => l !== null)
			.join('\n');
		writeFileSync(join(outDir, `${slug}.txt`), input);
		manifest.push({ slug, url, title, chars: text.length });
		console.log(`ok   ${slug}: "${title}" (${text.length} chars)`);
	} catch (e) {
		console.log(`FAIL ${slug}: ${e.message}`);
	}
}
writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
