import { AUTH_PASSWORD } from '$env/static/private';

export const COOKIE_NAME = 'auth-session';

const encoder = new TextEncoder();

async function hmacHex(message: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		'raw',
		encoder.encode(AUTH_PASSWORD),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
	return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// The cookie stores this derived token instead of the plaintext password
export function sessionToken(): Promise<string> {
	return hmacHex('session-v1');
}

// Timing-safe comparison: HMAC both sides so the string compare leaks nothing
export async function safeEqual(a: string, b: string): Promise<boolean> {
	const [ha, hb] = await Promise.all([hmacHex(a), hmacHex(b)]);
	return ha === hb;
}
