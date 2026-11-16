import { describe, expect, it } from 'vitest';
import { isPublicWebUrl, isWebUrl } from './urls';

describe('isWebUrl', () => {
	it('accepts only http(s)', () => {
		expect(isWebUrl('https://example.com')).toBe(true);
		expect(isWebUrl('javascript:alert(1)')).toBe(false);
		expect(isWebUrl('data:image/png;base64,AAAA')).toBe(false);
		expect(isWebUrl('not a url')).toBe(false);
	});
});

describe('isPublicWebUrl', () => {
	it('accepts public web addresses', () => {
		expect(isPublicWebUrl('https://cdn.example.com/a.jpg')).toBe(true);
		expect(isPublicWebUrl('http://93.184.216.34/a.png')).toBe(true);
		expect(isPublicWebUrl('https://[2606:4700::1111]/')).toBe(true);
		expect(isPublicWebUrl('https://172.32.0.1/')).toBe(true);
	});

	it('rejects other schemes and local, private or link-local hosts', () => {
		for (const url of [
			'file:///etc/passwd',
			'blob:https://example.com/123',
			'data:image/png;base64,AAAA',
			'http://localhost:3000/a.png',
			'http://localhost./',
			'http://foo.local./',
			'http://[::ffff:7f00:1]/',
			'http://LOCALHOST./',
			'http://app.localhost/',
			'http://nas.local/',
			'http://metadata.google.internal/',
			'http://127.0.0.1/',
			'http://0x7f.1/',
			'http://2130706433/',
			'http://0.0.0.0/',
			'http://10.0.0.5/',
			'http://172.16.0.1/',
			'http://172.31.255.255/',
			'http://192.168.1.1/',
			'http://169.254.169.254/latest/meta-data/',
			'http://[::1]/',
			'http://[0:0:0:0:0:0:0:1]/',
			'http://[::]/',
			'http://[fd12::1]/',
			'http://[fe80::1]/',
			'http://[::ffff:127.0.0.1]/'
		]) {
			expect(isPublicWebUrl(url), url).toBe(false);
		}
	});
});
