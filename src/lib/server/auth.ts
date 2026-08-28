import { env } from '$env/dynamic/private';

export const COOKIE_NAME = 'auth-session';

const encoder = new TextEncoder();

// Read at runtime (Cloudflare worker secret in prod, .env.local in dev) so the
// password can be rotated without rebuilding the app
async function hmacHex(message: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		'raw',
		encoder.encode(env.AUTH_PASSWORD),
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

// Timing-safe comparison: HMAC both sides so the string compare leaks nothing.
// Fails closed when AUTH_PASSWORD is unset.
export async function safeEqual(a: string, b: string): Promise<boolean> {
	if (!env.AUTH_PASSWORD) return false;
	const [ha, hb] = await Promise.all([hmacHex(a), hmacHex(b)]);
	return ha === hb;
}

export async function verifyPassword(password: string): Promise<boolean> {
	if (!env.AUTH_PASSWORD) return false;
	return safeEqual(password, env.AUTH_PASSWORD);
}

export async function isValidSession(cookie: string): Promise<boolean> {
	if (!env.AUTH_PASSWORD) return false;
	return safeEqual(cookie, await sessionToken());
}
