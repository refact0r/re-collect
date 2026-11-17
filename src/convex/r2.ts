import { R2 } from '@convex-dev/r2';
import { ConvexError, v } from 'convex/values';
import { components, internal } from './_generated/api';
import { internalMutation, internalQuery, type QueryCtx } from './_generated/server';
import { requireUser, userMutation, type UserQueryCtx } from './lib/auth';
import { RASTER_IMAGE_TYPES } from './lib/images';

export const r2 = new R2(components.r2);

const UPLOAD_URL_TTL_S = 15 * 60;
// Upload URLs expire well before this, so a row this old was abandoned
const UPLOAD_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const SWEEP_BATCH = 100;

const uploadByKey = (ctx: Pick<QueryCtx, 'db'>, key: string) =>
	ctx.db
		.query('uploads')
		.withIndex('by_key', (q) => q.eq('key', key))
		.unique();

// The caller's upload for `key`, or null if someone else minted it
export async function getOwnUpload(ctx: UserQueryCtx, key: string) {
	const upload = await uploadByKey(ctx, key);
	return upload?.userId === ctx.userId ? upload : null;
}

// The token's own upload for `key` that is still to be verified, else null
export const pendingUpload = internalQuery({
	args: { key: v.string(), token: v.string() },
	handler: async (ctx, { key, token }) => {
		const userId = await requireUser(ctx, token);
		const upload = await uploadByKey(ctx, key);
		return upload?.userId === userId && !upload.verifiedType ? upload : null;
	}
});

const encoder = new TextEncoder();
const toHex = (bytes: ArrayBuffer) =>
	[...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = async (text: string) =>
	toHex(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
async function hmac(key: BufferSource, text: string) {
	const cryptoKey = await crypto.subtle.importKey(
		'raw',
		key,
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	return await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(text));
}
// SigV4 wants RFC 3986 encoding, which also escapes !'()*
const uriEncode = (text: string) =>
	encodeURIComponent(text).replace(
		/[!'()*]/g,
		(c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
	);

// A presigned PUT (SigV4 query auth) that R2 accepts only with this exact
// Content-Type header, which the object is then served with. The component's
// generateUploadUrl signs no content type.
export async function signUpload(key: string, contentType: string, now = new Date()) {
	const { bucket, endpoint, accessKeyId, secretAccessKey } = r2.config;
	// Each segment on its own: a key's slashes stay path separators
	const path = [bucket, ...key.split('/')].map(uriEncode).join('/');
	const url = new URL(`${endpoint.replace(/\/$/, '')}/${path}`);
	const amzDate = now.toISOString().replace(/[-:]|\.\d+/g, '');
	const scope = `${amzDate.slice(0, 8)}/auto/s3/aws4_request`;
	// In canonical (sorted) order
	const query = Object.entries({
		'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
		'X-Amz-Content-Sha256': 'UNSIGNED-PAYLOAD',
		'X-Amz-Credential': `${accessKeyId}/${scope}`,
		'X-Amz-Date': amzDate,
		'X-Amz-Expires': String(UPLOAD_URL_TTL_S),
		'X-Amz-SignedHeaders': 'content-type;host'
	})
		.map(([name, value]) => `${name}=${uriEncode(value)}`)
		.join('&');
	const request = [
		'PUT',
		url.pathname,
		query,
		`content-type:${contentType}`,
		`host:${url.host}`,
		'',
		'content-type;host',
		'UNSIGNED-PAYLOAD'
	].join('\n');
	const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256(request)].join('\n');
	let signingKey = await hmac(encoder.encode(`AWS4${secretAccessKey}`), amzDate.slice(0, 8));
	for (const part of ['auto', 's3', 'aws4_request']) signingKey = await hmac(signingKey, part);
	return `${url.origin}${url.pathname}?${query}&X-Amz-Signature=${toHex(await hmac(signingKey, toSign))}`;
}

// A key for the caller to PUT one raster image of `contentType` to. It can't
// become an item's image until it's verified: by imageImport.verifyUpload for
// the client's PUT, or by a server-side upload that checked its own bytes.
export const generateUploadUrl = userMutation({
	args: { contentType: v.string() },
	handler: async (ctx, { contentType }) => {
		if (!RASTER_IMAGE_TYPES.includes(contentType)) {
			throw new ConvexError('that is not a supported image');
		}
		const key = crypto.randomUUID();
		await ctx.db.insert('uploads', { userId: ctx.userId, key });
		return { key, url: await signUpload(key, contentType) };
	}
});

export const markVerified = internalMutation({
	args: { key: v.string(), contentType: v.string(), width: v.number(), height: v.number() },
	handler: async (ctx, { key, contentType, width, height }) => {
		const upload = await uploadByKey(ctx, key);
		if (!upload) throw new ConvexError('upload not found');
		await ctx.db.patch(upload._id, { verifiedType: contentType, width, height });
	}
});

// Deletes an upload that failed its check, object and row
export const discardUpload = internalMutation({
	args: { key: v.string() },
	handler: async (ctx, { key }) => {
		const upload = await uploadByKey(ctx, key);
		if (!upload) return;
		await r2.deleteObject(ctx, key);
		await ctx.db.delete(upload._id);
	}
});

// Deletes uploads never attached to an item (abandoned, failed PUT, or an
// items.add that threw) with their objects. items.add deletes the row when it
// consumes a key, so no row here belongs to a live item.
export const sweepUploads = internalMutation({
	args: {},
	handler: async (ctx) => {
		const stale = await ctx.db
			.query('uploads')
			.withIndex('by_creation_time', (q) => q.lt('_creationTime', Date.now() - UPLOAD_MAX_AGE_MS))
			.take(SWEEP_BATCH);
		for (const upload of stale) {
			await r2.deleteObject(ctx, upload.key);
			await ctx.db.delete(upload._id);
		}
		if (stale.length === SWEEP_BATCH) {
			await ctx.scheduler.runAfter(0, internal.r2.sweepUploads, {});
		}
	}
});
