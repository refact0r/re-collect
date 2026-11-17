import { describe, expect, it } from 'vitest';
import {
	blocksRequest,
	classifyError,
	collapseWhitespace,
	decodeEntities,
	isTrackerRequest,
	isValidUrl,
	pickInternalName
} from './lib';

describe('isValidUrl', () => {
	it('accepts public http(s) pages', () => {
		expect(isValidUrl('https://example.com/a?b=1')).toBe(true);
		expect(isValidUrl('http://93.184.216.34/')).toBe(true);
		expect(isValidUrl('https://[2606:4700::1111]/')).toBe(true);
	});

	it('rejects other schemes and local or private hosts', () => {
		for (const url of [
			'file:///etc/passwd',
			'javascript:alert(1)',
			'not a url',
			'http://localhost:3000',
			'http://localhost./',
			'http://foo.local./',
			'http://[::ffff:7f00:1]/',
			'http://0x7f.1/',
			'http://2130706433/',
			'http://app.localhost',
			'http://printer.local',
			'http://metadata.internal',
			'http://127.0.0.1',
			'http://10.1.2.3',
			'http://172.16.0.1',
			'http://192.168.1.1',
			'http://169.254.169.254',
			'http://0.0.0.0',
			'http://[::1]',
			'http://[fd00::1]',
			'http://[fe80::1]',
			'http://[::ffff:127.0.0.1]'
		]) {
			expect(isValidUrl(url), url).toBe(false);
		}
	});
});

describe('decodeEntities', () => {
	it('decodes named, decimal and hex entities in one pass', () => {
		expect(decodeEntities('Tom &amp; Jerry &#8212; &#x2019;s')).toBe('Tom & Jerry \u2014 \u2019s');
		expect(decodeEntities('&amp;lt;')).toBe('&lt;');
	});

	it('knows the common typographic entities', () => {
		expect(decodeEntities('A &mdash; B &ndash; C &hellip; &ldquo;q&rdquo; &lsquo;s&rsquo;')).toBe(
			'A \u2014 B \u2013 C \u2026 \u201cq\u201d \u2018s\u2019'
		);
		expect(decodeEntities('&copy; &middot; &laquo;x&raquo; &nbsp;')).toBe(
			'\u00a9 \u00b7 \u00abx\u00bb \u00a0'
		);
	});

	it('leaves unknown names and replaces invalid code points', () => {
		expect(decodeEntities('&bogus; &Eacute;')).toBe('&bogus; &Eacute;');
		expect(decodeEntities('&#x110000; &#0; &#xD800; &#99999999999999999999;')).toBe(
			'\ufffd \ufffd \ufffd \ufffd'
		);
	});
});

describe('collapseWhitespace', () => {
	it('turns a multi-line title into one line', () => {
		expect(collapseWhitespace('\n  Studio\n\t  \u2014 Work  \n')).toBe('Studio \u2014 Work');
	});
});

describe('isTrackerRequest', () => {
	it('blocks tracker hosts and their subdomains', () => {
		expect(isTrackerRequest('https://www.google-analytics.com/g/collect')).toBe(true);
		expect(isTrackerRequest('https://cdn.segment.com/analytics.js')).toBe(true);
		expect(isTrackerRequest('https://static.hotjar.com/c/hotjar.js')).toBe(true);
		expect(isTrackerRequest('https://analytics.tiktok.com/i18n/pixel.js')).toBe(true);
		expect(isTrackerRequest('https://www.facebook.com/tr?id=1&ev=PageView')).toBe(true);
	});

	it("doesn't block a site's own assets that mention trackers", () => {
		expect(isTrackerRequest('https://studio.com/work/advertising-campaign.jpg')).toBe(false);
		expect(isTrackerRequest('https://studio.com/analytics/chart.png')).toBe(false);
		expect(isTrackerRequest('https://segment.studio.com/hero.webp')).toBe(false);
		expect(isTrackerRequest('https://www.facebook.com/travel')).toBe(false);
		expect(isTrackerRequest('not a url')).toBe(false);
	});
});

describe('blocksRequest', () => {
	const tracker = 'https://www.googletagmanager.com/ns.html';

	it('blocks trackers, beacons and sockets, iframe documents included', () => {
		expect(blocksRequest(tracker, 'document', false)).toBe(true);
		expect(blocksRequest(tracker, 'script', false)).toBe(true);
		expect(blocksRequest('https://studio.com/beacon', 'ping', false)).toBe(true);
		expect(blocksRequest('wss://studio.com/live', 'websocket', false)).toBe(true);
		expect(blocksRequest('https://studio.com/hero.webp', 'image', false)).toBe(false);
	});

	it("never blocks the page's own navigation", () => {
		expect(blocksRequest('https://segment.com/', 'document', true)).toBe(false);
	});
});

describe('classifyError', () => {
	it('reads a navigation error by its net:: code even when the URL looks like a limit', () => {
		const message = 'net::ERR_NAME_NOT_RESOLVED at https://too-many-429.example/limit-exceeded';
		expect(classifyError(message, false)).toEqual({ status: 502, error: 'Domain not found' });
		expect(classifyError(message, true).status).toBe(502);
	});

	it('answers 429 only for limits hit while acquiring the browser', () => {
		expect(classifyError('Unable to create new browser: code: 429: rate limit', true)).toEqual({
			status: 429,
			error: 'Browser rendering rate limited'
		});
		expect(classifyError('Error at https://example.com/429', false).status).toBe(500);
	});

	it('maps the other failures', () => {
		expect(classifyError('net::ERR_CONNECTION_REFUSED at https://x.com', false).status).toBe(502);
		expect(classifyError('net::ERR_CERT_INVALID at https://x.com', false)).toEqual({
			status: 502,
			error: 'Failed to load page'
		});
		expect(classifyError('Navigation timeout of 10000 ms exceeded', false).status).toBe(504);
		expect(classifyError('Target closed', false).status).toBe(500);
	});
});

describe('pickInternalName', () => {
	const used = (familyName: string, glyphCount = 10, isCustomFont = true) => ({
		familyName,
		glyphCount,
		isCustomFont
	});

	it('picks the used font that matches the CSS family', () => {
		expect(pickInternalName('cinetype', [used('Inter', 50), used('GT Cinetype')])).toBe(
			'GT Cinetype'
		);
		expect(pickInternalName('Söhne', [used('Inter', 50), used('Sohne Buch')])).toBe('Sohne Buch');
		expect(pickInternalName('areal', [used('ABC Areal Superfamily Variable')])).toBe(
			'ABC Areal Superfamily Variable'
		);
	});

	it('falls back to the custom font with the most glyphs, and ignores system fonts', () => {
		expect(pickInternalName('fhd', [used('Xyz', 3), used('Qrs', 40)])).toBe('Qrs');
		expect(pickInternalName('Helvetica', [used('Liberation Sans', 99, false)])).toBeUndefined();
		expect(pickInternalName('kit', [used('  ')])).toBeUndefined();
	});
});
