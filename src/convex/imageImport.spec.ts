import { afterEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { decodeDataImage, fetchImage } from './imageImport';

const image = (format: 'png' | 'jpeg' | 'webp' | 'avif') =>
	sharp({ create: { width: 3, height: 2, channels: 3, background: '#c33' } })
		.toFormat(format)
		.toBuffer();
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="3" height="2"/>');

const dataUrl = (type: string, data: Buffer) => `data:${type};base64,${data.toString('base64')}`;

describe('decodeDataImage', () => {
	it('stores the type the bytes are, whatever the URL says', async () => {
		const png = await decodeDataImage(dataUrl('image/jpg', await image('png')));
		expect(png).toMatchObject({ contentType: 'image/png', width: 3, height: 2 });
		const webp = await decodeDataImage(dataUrl('image/webp', await image('webp')));
		expect(webp.contentType).toBe('image/webp');
	});

	it('stores AVIF as image/avif', async () => {
		const avif = await decodeDataImage(dataUrl('image/avif', await image('avif')));
		expect(avif.contentType).toBe('image/avif');
	});

	it('refuses SVG (even labelled as PNG), garbage and non-base64 URLs', async () => {
		await expect(decodeDataImage(dataUrl('image/png', SVG))).rejects.toThrow(
			'not a supported image'
		);
		await expect(decodeDataImage(dataUrl('image/png', Buffer.from('nope')))).rejects.toThrow(
			'not a supported image'
		);
		await expect(decodeDataImage('data:image/png,abc')).rejects.toThrow('not a supported image');
	});

	it('refuses an image over 32 megapixels', async () => {
		const huge = await sharp({
			create: { width: 8000, height: 6000, channels: 3, background: '#c33' }
		})
			.png()
			.toBuffer();
		await expect(decodeDataImage(dataUrl('image/png', huge))).rejects.toThrow('over 32 megapixels');
	});

	it('refuses anything over the cap before decoding it', async () => {
		const huge = `data:image/png;base64,${'A'.repeat(41 * 1024 * 1024)}`;
		await expect(decodeDataImage(huge)).rejects.toThrow('over 30 MB');
	});
});

describe('fetchImage', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	const respond = (body: Buffer | null, init: ResponseInit) =>
		vi.fn(async () => new Response(body ? new Uint8Array(body) : null, init));

	it("doesn't fetch local or non-web addresses", async () => {
		const fetch = respond(await image('png'), { headers: { 'content-type': 'image/png' } });
		vi.stubGlobal('fetch', fetch);
		await expect(fetchImage('http://127.0.0.1/a.png')).rejects.toThrow("can't be fetched");
		await expect(fetchImage('file:///etc/passwd')).rejects.toThrow("can't be fetched");
		expect(fetch).not.toHaveBeenCalled();
	});

	it('re-checks the address a redirect points to', async () => {
		const fetch = respond(null, { status: 302, headers: { location: 'http://169.254.169.254/' } });
		vi.stubGlobal('fetch', fetch);
		await expect(fetchImage('https://example.com/a.png')).rejects.toThrow("can't be fetched");
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it('accepts loosely labelled images and stores them by their bytes', async () => {
		for (const type of ['image/jpg', 'image/x-png', 'application/octet-stream']) {
			vi.stubGlobal('fetch', respond(await image('png'), { headers: { 'content-type': type } }));
			const fetched = await fetchImage('https://example.com/a');
			expect(fetched.contentType, type).toBe('image/png');
		}
	});

	it('refuses a declared SVG without reading it, and an SVG in disguise', async () => {
		vi.stubGlobal('fetch', respond(SVG, { headers: { 'content-type': 'image/svg+xml' } }));
		await expect(fetchImage('https://example.com/a.svg')).rejects.toThrow('not a supported image');
		vi.stubGlobal('fetch', respond(SVG, { headers: { 'content-type': 'image/png' } }));
		await expect(fetchImage('https://example.com/a.png')).rejects.toThrow('not a supported image');
	});
});
