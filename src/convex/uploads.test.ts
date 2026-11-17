// @vitest-environment node
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api } from './_generated/api';
import { r2, signUpload } from './r2';
import { makeUser, newTest, stubR2, type Test } from './testing.helpers';

// Runs in node, not edge-runtime: imageImport's actions decode images with sharp

const png = await sharp({
	create: { width: 3, height: 2, channels: 3, background: '#c00' }
})
	.png()
	.toBuffer();
const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
const html = '<!doctype html><script>alert(1)</script>';

let deleted: ReturnType<typeof stubR2>;

beforeEach(() => {
	vi.useFakeTimers(); // Scheduled tagging and embedding never start
	deleted = stubR2();
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

// The bucket, as reached by verifyUpload's read and the server-side PUTs
function serve(body: BodyInit, contentType: string) {
	const fetch = vi.fn(async (_url: string, init?: RequestInit) =>
		init?.method === 'PUT'
			? new Response(null, { status: 200 })
			: new Response(body, { headers: { 'content-type': contentType } })
	);
	vi.stubGlobal('fetch', fetch);
	return fetch;
}

const uploads = (t: Test) => t.run((ctx) => ctx.db.query('uploads').collect());

describe('upload URLs', () => {
	test('sign the content type, as the AWS SDK signs the same request', async () => {
		Object.assign(r2.config, {
			bucket: 'my-bucket',
			endpoint: 'https://abc123.r2.cloudflarestorage.com'
		});
		const key = '6f1c2a9e-1234-4abc-9def-0123456789ab';
		const url = new URL(await signUpload(key, 'image/png', new Date('2026-11-16T12:34:56.789Z')));
		expect(url.host).toBe('abc123.r2.cloudflarestorage.com');
		expect(url.pathname).toBe(`/my-bucket/${key}`);
		expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('content-type;host');
		// From @smithy/signature-v4's presign (the SDK's signer) with content-type
		// signable, for the same request, time and credentials
		expect(url.searchParams.get('X-Amz-Signature')).toBe(
			'6733f3ed6d01d0c3667bad0748e501b35f6e488501b2f06d18e14056f87e15f9'
		);
	});

	test("keep a key's slashes as path separators, as R2 signs the path", async () => {
		Object.assign(r2.config, { bucket: 'my-bucket' });
		const url = new URL(await signUpload('variants/a b-512w.webp', 'image/webp'));
		expect(url.pathname).toBe('/my-bucket/variants/a%20b-512w.webp');
	});

	test('are only minted for raster image types', async () => {
		const t = newTest();
		const { token } = await makeUser(t);
		for (const contentType of ['image/svg+xml', 'text/html', 'application/octet-stream', '']) {
			await expect(t.mutation(api.r2.generateUploadUrl, { contentType, token })).rejects.toThrow(
				'that is not a supported image'
			);
		}
		expect(await uploads(t)).toEqual([]);

		const { key, url } = await t.mutation(api.r2.generateUploadUrl, {
			contentType: 'image/webp',
			token
		});
		expect(url).toContain(key);
		expect((await uploads(t)).map((u) => [u.key, u.verifiedType])).toEqual([[key, undefined]]);
	});
});

describe('direct uploads', () => {
	async function pending(t: Test, token: string) {
		const { key } = await t.mutation(api.r2.generateUploadUrl, { contentType: 'image/png', token });
		return key;
	}

	test('a verified raster image can be attached, once, at its decoded size', async () => {
		const t = newTest();
		const { token } = await makeUser(t);
		const key = await pending(t, token);
		serve(new Uint8Array(png), 'image/png');

		await t.action(api.imageImport.verifyUpload, { key, token });
		expect(await uploads(t)).toMatchObject([
			{ key, verifiedType: 'image/png', width: 3, height: 2 }
		]);
		const itemId = await t.mutation(api.items.add, { type: 'image', imageKey: key, token });
		expect(await t.run((ctx) => ctx.db.get(itemId))).toMatchObject({
			imageWidth: 3,
			imageHeight: 2
		});
		await expect(
			t.mutation(api.items.add, { type: 'image', imageKey: key, token })
		).rejects.toThrow('upload not found');
		expect(deleted).not.toHaveBeenCalled();
	});

	test.each([
		['an SVG', svg, 'image/svg+xml'],
		['HTML', html, 'text/html'],
		['HTML served as an image', html, 'image/png'],
		['unknown bytes', 'not an image', 'image/png'],
		['an untyped object', new Uint8Array(png), 'application/octet-stream']
	])('%s is refused, deleted and never attachable', async (_, body, contentType) => {
		const t = newTest();
		const { token } = await makeUser(t);
		const key = await pending(t, token);
		serve(body, contentType);

		await expect(t.action(api.imageImport.verifyUpload, { key, token })).rejects.toThrow(
			'that is not a supported image'
		);
		expect(deleted).toHaveBeenCalledExactlyOnceWith(expect.anything(), key);
		expect(await uploads(t)).toEqual([]);
		await expect(
			t.mutation(api.items.add, { type: 'image', imageKey: key, token })
		).rejects.toThrow('upload not found');
	});

	test('an unverified upload is refused by items.add', async () => {
		const t = newTest();
		const { token } = await makeUser(t);
		const key = await pending(t, token);
		for (const type of ['image', 'url'] as const) {
			await expect(
				t.mutation(api.items.add, { type, url: 'https://example.com', imageKey: key, token })
			).rejects.toThrow('that is not a supported image');
		}
	});

	test("another user's upload can be neither verified nor attached", async () => {
		const t = newTest();
		const { token: a } = await makeUser(t, 'a');
		const { token: b } = await makeUser(t, 'b');
		const key = await pending(t, a);
		const fetch = serve(new Uint8Array(png), 'image/png');

		await expect(t.action(api.imageImport.verifyUpload, { key, token: b })).rejects.toThrow(
			'upload not found'
		);
		expect(fetch).not.toHaveBeenCalled();
		await t.action(api.imageImport.verifyUpload, { key, token: a });
		await expect(
			t.mutation(api.items.add, { type: 'image', imageKey: key, token: b })
		).rejects.toThrow('upload not found');
	});
});

describe('server-side imports', () => {
	const dataUrl = `data:image/png;base64,${png.toString('base64')}`;

	test('attach the image they checked and uploaded', async () => {
		const t = newTest();
		const { token } = await makeUser(t);
		const fetch = serve('', 'text/plain');

		const { type } = await t.action(api.imageImport.addFromUrl, { imageUrl: dataUrl, token });
		expect(type).toBe('image');
		await t.action(api.imageImport.addPageWithImage, {
			url: 'https://example.com',
			imageUrl: dataUrl,
			token
		});

		// Each PUT carried the content type its URL was signed for
		const puts = fetch.mock.calls.filter(([, init]) => init?.method === 'PUT');
		expect(puts).toHaveLength(2);
		for (const [url, init] of puts) {
			expect(url).toContain('X-Amz-SignedHeaders=content-type%3Bhost');
			expect(init?.headers).toEqual({ 'Content-Type': 'image/png' });
		}
		const items = await t.run((ctx) => ctx.db.query('items').collect());
		expect(items.map((item) => [item.type, item.imageWidth, item.imageHeight])).toEqual([
			['image', 3, 2],
			['url', 3, 2]
		]);
		expect(await uploads(t)).toEqual([]);
	});
});
