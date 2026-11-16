import { describe, expect, test } from 'vitest';
import {
	decodeEntities,
	parseArena,
	parseRss,
	parseSeesaw,
	type ArenaBlock
} from './discoverySources';

describe('decodeEntities', () => {
	test('unwraps CDATA and decodes named and numeric entities', () => {
		expect(decodeEntities('<![CDATA[Caf&#233; &amp; &#x2014; &quot;Co&quot;]]>')).toBe(
			'Café & — "Co"'
		);
	});

	test('an out-of-range numeric entity becomes the replacement character', () => {
		expect(decodeEntities('a &#x110000; b &#99999999; c')).toBe('a � b � c');
	});
});

const rssItem = (fields: string) => `<item>${fields}</item>`;
const rss = (...items: string[]) =>
	`<?xml version="1.0"?><rss><channel>${items.join('')}</channel></rss>`;
const pubDate = '<pubDate>Mon, 16 Nov 2026 10:00:00 +0000</pubDate>';

describe('parseRss', () => {
	test('reads title and description through CDATA and entities, media:content first', () => {
		const [entry] = parseRss(
			rss(
				rssItem(`
					<title><![CDATA[Website Inspiration: Caf&#233; &amp; Co]]></title>
					<link>https://gallery.example/sites/cafe</link>
					<guid>cafe-1</guid>
					${pubDate}
					<dc:creator><![CDATA[Ana]]></dc:creator>
					<category><![CDATA[Inspiration]]></category>
					<category><![CDATA[Food &amp; Drink]]></category>
					<media:content url="https://cdn.example/a.jpg?w=1&amp;h=2" medium="image" width="1600" height="1000" />
					<description><![CDATA[<p>A <b>bold</b> site <img src="https://cdn.example/other.jpg"></p> Full Review]]></description>
				`)
			)
		);
		expect(entry).toEqual({
			externalId: 'cafe-1',
			kind: 'site',
			url: 'https://gallery.example/sites/cafe',
			title: 'Café & Co',
			description: 'A bold site',
			imageUrl: 'https://cdn.example/a.jpg?w=1&h=2',
			imageWidth: 1600,
			imageHeight: 1000,
			publishedAt: Date.parse('2026-11-16T10:00:00Z')
		});
	});

	test('falls back to the first <img>, resolved against the entry link', () => {
		const entries = parseRss(
			rss(
				rssItem(`<title>B</title><link>https://gallery.example/sites/b</link>${pubDate}
					<description>&lt;img src="/shots/b.png"&gt;</description>`),
				rssItem(`<title>C</title><link>https://gallery.example/sites/c</link>${pubDate}
					<content:encoded><![CDATA[<img src='//cdn.example/c.png'>]]></content:encoded>`)
			)
		);
		expect(entries.map((e) => e.imageUrl)).toEqual([
			'https://gallery.example/shots/b.png',
			'https://cdn.example/c.png'
		]);
		expect(entries[0].imageWidth).toBeUndefined();
	});

	test('skips entries without a valid pubDate, a link or an image', () => {
		const img = '<description><![CDATA[<img src="https://cdn.example/x.png">]]></description>';
		expect(
			parseRss(
				rss(
					rssItem(`<link>https://a.example/</link>${img}`),
					rssItem(`<link>https://b.example/</link><pubDate>not a date</pubDate>${img}`),
					rssItem(`${pubDate}${img}`),
					rssItem(`<link>https://c.example/</link>${pubDate}`),
					// A relative image can't resolve against a non-web link
					rssItem(`<link>javascript:alert(1)</link>${pubDate}
						<description>&lt;img src="/x.png"&gt;</description>`)
				)
			)
		).toEqual([]);
	});
});

describe('parseSeesaw', () => {
	test('reads the sites from a payload split across chunks', () => {
		const payload =
			'0:["$","div",null,{"sites":[' +
			'{"id":"s1","title":"One","link":"https://one.example/?utm_source=seesaw","publishedDate":"2026-11-10","category":["c1"],"imgId":"abc"},' +
			'{"id":"s2","title":"Two \\"quoted\\"","description":"Hi","link":"https://two.example","publishedDate":"2026-11-12","imgId":"def"},' +
			'{"id":"s3","title":"No image","link":"https://three.example","publishedDate":"2026-11-13"}' +
			']}]\n1:{"categories":[{"id":"c1","name":"Portfolio"}]}';
		const at = payload.indexOf('"title":"Two');
		const html = [payload.slice(0, at), payload.slice(at)]
			.map((chunk) => `<script>self.__next_f.push([1,${JSON.stringify(chunk)}])</script>`)
			.join('\n');

		const entries = parseSeesaw(html);
		expect(entries.map((e) => [e.externalId, e.url, e.title])).toEqual([
			['s2', 'https://two.example/', 'Two "quoted"'],
			['s1', 'https://one.example/', 'One']
		]);
		expect(entries[0]).toMatchObject({
			kind: 'site',
			description: 'Hi',
			imageUrl: 'https://res.cloudinary.com/seesawsite/video/upload/w_1440/def.jpg',
			publishedAt: Date.parse('2026-11-12')
		});
	});

	test('fails loudly when the payload has no sites', () => {
		expect(() => parseSeesaw('<html></html>')).toThrow('no sites');
	});
});

describe('parseArena', () => {
	const block = (fields: Partial<ArenaBlock>): ArenaBlock => ({
		id: 1,
		type: 'Link',
		created_at: '2026-11-01T00:00:00Z',
		...fields
	});

	test('a Link block keeps as its site, an Image block links to the block', () => {
		const entries = parseArena([
			block({
				id: 1,
				title: 'A site',
				description: { plain: 'Notes' },
				source: { url: 'https://site.example/' },
				image: { width: 1200, height: 800, large: { src: 'https://img.are.na/1.jpg' } },
				connection: { connected_at: '2026-11-15T00:00:00Z' }
			}),
			block({
				id: 2,
				type: 'Image',
				title: 'IMG_0001.jpg',
				source: { url: 'https://cdn.example/IMG_0001.jpg' },
				image: { medium: { url: 'https://img.are.na/2.jpg' } }
			}),
			block({ id: 3, type: 'Text', title: 'Just words' }),
			block({ id: 4, source: { url: 'https://no-image.example/' } })
		]);
		expect(entries).toEqual([
			{
				externalId: '1',
				kind: 'site',
				url: 'https://site.example/',
				title: 'A site',
				description: 'Notes',
				imageUrl: 'https://img.are.na/1.jpg',
				imageWidth: 1200,
				imageHeight: 800,
				publishedAt: Date.parse('2026-11-15T00:00:00Z')
			},
			{
				externalId: '2',
				kind: 'image',
				url: 'https://www.are.na/block/2',
				title: undefined,
				description: undefined,
				imageUrl: 'https://img.are.na/2.jpg',
				imageWidth: undefined,
				imageHeight: undefined,
				publishedAt: Date.parse('2026-11-01T00:00:00Z')
			}
		]);
	});
});
