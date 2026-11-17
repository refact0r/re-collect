// Discovery feed adapters: each reads one outside source with a plain fetch and
// maps its entries to the shared candidate shape. Media are the source's own
// (hotlinked in the feed, copied into R2 only on keep); nothing is screenshotted.
// Recipes and caveats per source: reference/discovery-research.md §1b.

import { isWebUrl } from './urls';

export type SourceConfig = {
	key: string;
	name: string;
	// Sources sharing a group take one feed slot between them (see discovery.feed)
	group?: string;
} & (
	| { kind: 'recent' | 'seesaw' | 'typographicposters' }
	| { kind: 'rss'; url: string }
	| { kind: 'arena'; slug: string }
);

export interface FetchedCandidate {
	externalId: string;
	// 'site' keeps as a URL item with this image, 'image' as an image item
	kind: 'site' | 'image';
	url: string;
	title?: string;
	description?: string;
	imageUrl: string;
	imageWidth?: number;
	imageHeight?: number;
	videoUrl?: string;
	publishedAt: number;
}

const arena = (slug: string, name: string, group: string): SourceConfig => ({
	key: `arena:${slug}`,
	name,
	kind: 'arena',
	slug,
	group
});
const ARENA_WEB = 'Are.na · web';
const ARENA_MOTION = 'Are.na · motion & code';
const ARENA_GRAPHIC = 'Are.na · graphic & type';

// The curated source list: every user's feed draws from these (each user can
// turn some off). Edit here and deploy. Are.na channels were scouted and then
// pruned by eye on 2026-11-14 (reference/discovery-notes/arena-channels.md).
export const SOURCES: SourceConfig[] = [
	{ key: 'recent-x', name: 'Recent', kind: 'recent' },
	{ key: 'seesaw', name: 'Seesaw', kind: 'seesaw' },
	{ key: 'awwwards', name: 'Awwwards', kind: 'rss', url: 'https://www.awwwards.com/feed/' },
	{ key: 'onepagelove', name: 'One Page Love', kind: 'rss', url: 'https://onepagelove.com/feed' },
	{
		key: 'siteinspire',
		name: 'Siteinspire',
		kind: 'rss',
		url: 'https://www.siteinspire.com/websites/feed'
	},
	{ key: 'typographicposters', name: 'Typographic Posters', kind: 'typographicposters' },

	arena('websites-skgmukjoccg', 'Websites (ryan-foo)', ARENA_WEB),
	arena('interesting-web-design-and-ux', 'Interesting Web Design and UX', ARENA_WEB),
	arena('web-inspiration-yg1uretked0', 'Web-Inspiration', ARENA_WEB),
	arena('websites-and-work', 'Websites and Work', ARENA_WEB),

	arena('motion-_zversmdrws', 'Motion (breanna-lorraine-nazaire)', ARENA_MOTION),
	arena('simply-motion', 'Simply motion', ARENA_MOTION),
	arena('web-art-shvuorwbs8m', 'web/art', ARENA_MOTION),

	arena('gr-26-graphics-thisisgrey-likes', 'GR 26 — Graphics ThisisGrey likes', ARENA_GRAPHIC),
	arena('graphic-sammal', 'Graphic – Sammal', ARENA_GRAPHIC),
	arena('design-production-visuals', 'Design / Production / Visuals', ARENA_GRAPHIC)
];

const BROWSER_UA =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';
// Are.na refuses browser UAs from servers. A personal access token
// (ARENA_TOKEN env var) lifts the limit from 30/min per shared Convex IP to
// 120/min per account.
const arenaHeaders = (): Record<string, string> => ({
	'User-Agent': 're-collect discovery (personal feed reader)',
	...(process.env.ARENA_TOKEN ? { Authorization: `Bearer ${process.env.ARENA_TOKEN}` } : {})
});
const TIMEOUT_MS = 20_000;

async function get(url: string, init: RequestInit = {}) {
	const response = await fetch(url, {
		...init,
		headers: { 'User-Agent': BROWSER_UA, ...init.headers },
		signal: AbortSignal.timeout(TIMEOUT_MS)
	});
	if (!response.ok) throw new Error(`${url}: ${response.status}`);
	return response;
}

const getText = async (url: string) => (await get(url)).text();

const getJson = async <T>(url: string, init?: RequestInit) =>
	(await (await get(url, init)).json()) as T;

// Drops tracking params from a link we store
function cleanUrl(value: string): string {
	try {
		const url = new URL(value);
		for (const param of [...url.searchParams.keys()]) {
			if (/^(ref|utm_.*)$/i.test(param)) url.searchParams.delete(param);
		}
		return url.toString();
	} catch {
		return value;
	}
}

// Past the last code point, fromCodePoint throws: the replacement character instead
const codePoint = (n: number) => (n <= 0x10ffff ? String.fromCodePoint(n) : '�');

export const decodeEntities = (s: string) =>
	s
		.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
		.replace(/&#(\d+);/g, (_, n) => codePoint(Number(n)))
		.replace(/&#x([0-9a-f]+);/gi, (_, n) => codePoint(parseInt(n, 16)))
		.replace(/&quot;/g, '"')
		.replace(/&#039;|&apos;/g, "'")
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&amp;/g, '&');

const stripTags = (s: string) =>
	decodeEntities(s)
		.replace(/<[^>]+>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();

// ============ Recent (api.recent.design, oRPC) ============

interface RecentMedia {
	mediaType: string;
	url: string;
	mediaWidth?: number;
	mediaHeight?: number;
	poster?: { url: string; width: number; height: number };
	renditions?: { url: string; width: number; height: number }[];
}

// The fields used here, as the API sends them
interface RecentItem {
	id: string;
	title?: string;
	description?: string | null;
	source?: { url?: string };
	cover?: RecentMedia;
	media?: RecentMedia[];
	publishedAt?: number;
	createdAt: number;
}

async function fetchRecent(): Promise<FetchedCandidate[]> {
	const { json } = await getJson<{ json: { items: RecentItem[] } }>(
		'https://api.recent.design/rpc/items/list',
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ json: { feed: 'x', format: 'tweet', sort: 'recent', limit: 40 } })
		}
	);

	return json.items.flatMap((item): FetchedCandidate[] => {
		const media = item.cover ?? item.media?.[0];
		const url = item.source?.url;
		if (!media || !url) return [];
		const isVideo = media.mediaType === 'video';
		// A mid-size rendition: the originals run to 4K
		const video = isVideo
			? (media.renditions?.find((r) => r.width >= 720) ?? media.renditions?.at(-1))
			: undefined;
		const image = isVideo
			? media.poster
			: { url: media.url, width: media.mediaWidth, height: media.mediaHeight };
		if (!image?.url) return [];
		return [
			{
				externalId: item.id,
				// An X post keeps as its media, linking back to the post
				kind: 'image',
				url,
				title: item.title,
				description: item.description ?? undefined,
				imageUrl: image.url,
				imageWidth: image.width ?? undefined,
				imageHeight: image.height ?? undefined,
				videoUrl: video?.url,
				publishedAt: item.publishedAt ?? item.createdAt
			}
		];
	});
}

// ============ Seesaw (Next.js RSC payload on the homepage) ============

// Reads the JSON value starting at `start` (an `[` or `{`)
function readJson(text: string, start: number): unknown {
	let depth = 0;
	let inString = false;
	for (let i = start; i < text.length; i++) {
		const c = text[i];
		if (inString) {
			if (c === '\\') i++;
			else if (c === '"') inString = false;
		} else if (c === '"') inString = true;
		else if (c === '[' || c === '{') depth++;
		else if (c === ']' || c === '}') {
			if (--depth === 0) return JSON.parse(text.slice(start, i + 1));
		}
	}
	throw new Error('unterminated JSON');
}

// The homepage's payload arrives in chunks, one script each
export function parseSeesaw(html: string): FetchedCandidate[] {
	const payload = [...html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)]
		.map((m) => JSON.parse(m[1]) as string)
		.join('');

	const sitesAt = payload.indexOf('{"sites":[');
	if (sitesAt < 0) throw new Error('seesaw: no sites in payload');
	const { sites } = readJson(payload, sitesAt) as {
		sites: {
			id: string;
			title: string;
			description?: string;
			link: string;
			publishedDate: string;
			imgId?: string;
		}[];
	};

	const cloudinary = 'https://res.cloudinary.com/seesawsite/video/upload';
	return sites
		.filter((site) => site.imgId && site.link)
		.map((site) => ({
			externalId: site.id,
			kind: 'site',
			url: cleanUrl(site.link),
			title: site.title,
			description: typeof site.description === 'string' ? site.description : undefined,
			imageUrl: `${cloudinary}/w_1440/${site.imgId}.jpg`,
			imageWidth: 1440,
			imageHeight: 809,
			videoUrl: `${cloudinary}/w_960,du_6/q_auto:eco/${site.imgId}.mp4`,
			publishedAt: Date.parse(site.publishedDate)
		}));
}

// ============ RSS (Awwwards, One Page Love, Siteinspire) ============

const tag = (xml: string, name: string) =>
	xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1];

// Gallery entries link to the gallery's own page; the original site is one
// fetch away on the ones that allow it
const ORIGINAL_LINK: Record<string, RegExp> = {
	awwwards: /<a class="toolbar-bts__item" href="([^"]+)"/,
	onepagelove: /<a href="([^"]+)"[^>]*title="Visit [^"]*Website"/
};

export async function resolveOriginal(sourceKey: string, pageUrl: string) {
	const pattern = ORIGINAL_LINK[sourceKey];
	if (!pattern) return null;
	try {
		const href = (await getText(pageUrl)).match(pattern)?.[1];
		if (!href) return null;
		const original = new URL(decodeEntities(href), pageUrl).href;
		return isWebUrl(original) ? cleanUrl(original) : null;
	} catch {
		return null;
	}
}

// Resolves an image src against its entry's page: relative and protocol-relative ones work
function absolute(src: string, base: string) {
	try {
		return new URL(src, base).href;
	} catch {
		return undefined;
	}
}

export function parseRss(xml: string): FetchedCandidate[] {
	return xml
		.split(/<item>/)
		.slice(1)
		.flatMap((item): FetchedCandidate[] => {
			const link = stripTags(tag(item, 'link') ?? '');
			const published = Date.parse(stripTags(tag(item, 'pubDate') ?? ''));
			const body = (tag(item, 'content:encoded') ?? '') + (tag(item, 'description') ?? '');
			// media:content (Siteinspire's 1600×1000 is the first) or the first <img>
			const media = item.match(
				/<media:content\s+url="([^"]+)"[\s\S]*?width="(\d+)"[\s\S]*?height="(\d+)"/
			);
			const img = decodeEntities(body).match(/<img[^>]+src=['"]([^'"]+)['"]/);
			const imageUrl = media ? decodeEntities(media[1]) : img && absolute(img[1], link);
			if (!link || !imageUrl || Number.isNaN(published)) return [];
			const description = stripTags(tag(item, 'description') ?? '').replace(/\s*Full Review$/, '');
			return [
				{
					externalId: stripTags(tag(item, 'guid') ?? link),
					kind: 'site',
					url: link,
					title: stripTags(tag(item, 'title') ?? '').replace(/^Website Inspiration:\s*/, ''),
					description: description && !description.startsWith('Credits:') ? description : undefined,
					imageUrl,
					imageWidth: media ? Number(media[2]) : undefined,
					imageHeight: media ? Number(media[3]) : undefined,
					publishedAt: published
				}
			];
		});
}

// ============ Are.na channels (v3 API) ============

export interface ArenaBlock {
	id: number;
	type: string;
	title?: string | null;
	description?: { plain?: string } | null;
	source?: { url?: string } | null;
	image?: {
		width?: number;
		height?: number;
		large?: { src?: string; url?: string };
		medium?: { src?: string; url?: string };
	} | null;
	connection?: { connected_at?: string };
	created_at: string;
}

async function fetchArena(slug: string): Promise<FetchedCandidate[]> {
	const { data } = await getJson<{ data: ArenaBlock[] }>(
		`https://api.are.na/v3/channels/${encodeURIComponent(slug)}/contents?per=100&sort=created_at_desc`,
		{ headers: arenaHeaders() }
	);
	return parseArena(data);
}

export function parseArena(blocks: ArenaBlock[]): FetchedCandidate[] {
	return blocks.flatMap((block): FetchedCandidate[] => {
		if (block.type !== 'Image' && block.type !== 'Link') return [];
		const size = block.image?.large ?? block.image?.medium;
		const imageUrl = size?.src ?? size?.url;
		if (!imageUrl) return [];
		// An Image block's source is the image file itself, so it links to the block
		const pageUrl = block.type === 'Link' ? block.source?.url : undefined;
		const title =
			block.title && !/\.(gif|jpe?g|png|webp)\b/i.test(block.title) ? block.title : undefined;
		return [
			{
				externalId: String(block.id),
				kind: pageUrl ? 'site' : 'image',
				url: pageUrl ?? `https://www.are.na/block/${block.id}`,
				title,
				description: block.description?.plain || undefined,
				imageUrl,
				imageWidth: block.image?.width,
				imageHeight: block.image?.height,
				publishedAt: Date.parse(block.connection?.connected_at ?? block.created_at)
			}
		];
	});
}

// ============ typographicposters.com (open JSON) ============

interface Poster {
	id: string; // Mongo ObjectId
	title: string;
	profileId: string;
	image?: { path: string; width: number; height: number };
}

async function fetchTypographicPosters(): Promise<FetchedCandidate[]> {
	// Not date-sorted; the newest few are spread over the first pages
	const pages = await Promise.all(
		[0, 1].map((page) =>
			getJson<{ hits: Poster[] }>(
				`https://www.typographicposters.com/api/tg/posters-recent?page=${page}&itemsPerPage=40`
			)
		)
	);
	const posters = pages.flatMap((page) => page.hits);
	return posters.flatMap((poster): FetchedCandidate[] => {
		const { image } = poster;
		if (!image?.path) return [];
		const scale = Math.min(1, 1132 / image.width);
		return [
			{
				externalId: poster.id,
				kind: 'image',
				url: `https://www.typographicposters.com/${poster.profileId}/${poster.id}`,
				title: poster.title,
				imageUrl: `https://images.typographicposters.com/poster-2x${image.path}`,
				imageWidth: Math.round(image.width * scale),
				imageHeight: Math.round(image.height * scale),
				// Mongo ObjectId: the first 4 bytes are the creation time
				publishedAt: parseInt(poster.id.slice(0, 8), 16) * 1000
			}
		];
	});
}

export async function fetchSource(source: SourceConfig): Promise<FetchedCandidate[]> {
	switch (source.kind) {
		case 'recent':
			return fetchRecent();
		case 'seesaw':
			return parseSeesaw(await getText('https://www.seesaw.website/'));
		case 'rss':
			return parseRss(await getText(source.url));
		case 'arena':
			return fetchArena(source.slug);
		case 'typographicposters':
			return fetchTypographicPosters();
	}
}
