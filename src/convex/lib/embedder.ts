import type { Doc } from '../_generated/dataModel';

// The embedding boundary: what each item embeds as, and the Workers AI call.
// Holds no Convex functions, so actions in either runtime and plain specs can
// import it. Model choice: reference/embeddings-research.md.

const MODEL_ID = '@cf/google/embeddinggemma-2';
export const EMBEDDING_DIMENSIONS = 768;
// Stored on every row; bump it to re-embed everything (embeddings:backfill)
export const EMBEDDING_MODEL = `google/embeddinggemma-2@${EMBEDDING_DIMENSIONS}`;

const TIMEOUT_MS = 30_000;
// A search waits on its query's embedding, so it gets one quick try
const QUERY_TIMEOUT_MS = 5_000;
// ~2k tokens: enough to place an article or note without paying for all of it
const MAX_TEXT_CHARS = 8_000;

export type EmbeddingInput = { kind: 'image'; imageKey: string } | { kind: 'text'; text: string };

type EmbeddingFields = Pick<
	Doc<'items'>,
	| 'type'
	| 'title'
	| 'description'
	| 'ogDescription'
	| 'url'
	| 'content'
	| 'subject'
	| 'styles'
	| 'aiTags'
	| 'imageKey'
	| 'screenshotStatus'
	| 'taggingStatus'
	| 'taggingMode'
>;

// What an item embeds as, or null when it has AI off or is still waiting on the
// input it should embed (an image on its way, or text-mode tags not written yet).
// Images embed as pixels; text-mode links and notes embed as their words.
export function embeddingInput(item: EmbeddingFields): EmbeddingInput | null {
	if (item.taggingMode === 'none') return null;
	const textMode = item.taggingMode === 'text';
	// A capture (first or redone) on its way replaces whatever image is there
	if (item.type === 'url' && !textMode && item.screenshotStatus === 'pending') return null;
	if (item.imageKey && !textMode) return { kind: 'image', imageKey: item.imageKey };
	if (textMode && item.taggingStatus === 'pending') return null;
	return { kind: 'text', text: documentText(item) };
}

function hostname(url: string | undefined) {
	try {
		return url ? new URL(url).hostname.replace(/^www\./, '') : undefined;
	} catch {
		return undefined;
	}
}

// EmbeddingGemma's document format: `title: … | text: …`
export function documentText(item: Partial<EmbeddingFields>): string {
	const text = [
		item.subject,
		item.ogDescription,
		item.description,
		item.styles?.join(', '),
		item.aiTags?.join(', '),
		item.content,
		hostname(item.url)
	]
		.filter(Boolean)
		.join('\n');
	return `title: ${item.title?.trim() || 'none'} | text: ${text}`.slice(0, MAX_TEXT_CHARS);
}

// The search-query side of the same format
export const queryText = (query: string) => `task: search result | query: ${query.trim()}`;

// Identifies an input, so re-running an unchanged item can skip the API call
export async function inputKey(input: EmbeddingInput): Promise<string> {
	if (input.kind === 'image') return `image:${input.imageKey}`;
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input.text));
	const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
	return `text:${hex.slice(0, 32)}`;
}

// Only image embeddings are laid out on the library map
export const isImageKey = (key: string) => key.startsWith('image:');

// What an item still needs embedded, given the input key of its current-model
// embedding: null when it has AI off, is waiting on its input, or is up to date
export async function embeddingToMake(item: EmbeddingFields, embeddedKey: string | null) {
	const input = embeddingInput(item);
	if (!input) return null;
	const key = await inputKey(input);
	return key === embeddedKey ? null : { input, key };
}

type ContentPart =
	{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

interface EmbeddingResponse {
	data?: { embedding: number[] }[];
}

// Rate limits, server errors and timeouts are worth another try (embedItem's
// pool retries them); a bad request isn't
export class RetryableError extends Error {}

async function run(body: object, timeoutMs: number): Promise<number[]> {
	const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
	const token = process.env.CLOUDFLARE_API_TOKEN;
	if (!accountId || !token) throw new Error('CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN not set');

	let response: Response;
	try {
		response = await fetch(
			`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${MODEL_ID}`,
			{
				method: 'POST',
				headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
				body: JSON.stringify({ ...body, dimensions: EMBEDDING_DIMENSIONS }),
				signal: AbortSignal.timeout(timeoutMs)
			}
		);
	} catch (error) {
		throw new RetryableError(`Workers AI request failed: ${error}`);
	}
	if (!response.ok) {
		const message = `Workers AI ${response.status}: ${(await response.text()).slice(0, 300)}`;
		throw response.status === 429 || response.status >= 500
			? new RetryableError(message)
			: new Error(message);
	}
	// The REST API wraps the model's output in { result, success }
	const json = (await response.json()) as { result?: EmbeddingResponse };
	const embedding = json.result?.data?.[0]?.embedding;
	if (embedding?.length !== EMBEDDING_DIMENSIONS) {
		throw new Error(`Workers AI returned no ${EMBEDDING_DIMENSIONS}-d embedding`);
	}
	return normalize(embedding);
}

// Unit length, so a dot product is the cosine similarity
function normalize(vector: number[]): number[] {
	const norm = Math.hypot(...vector) || 1;
	return vector.map((x) => x / norm);
}

const conversation = (content: ContentPart[]) => ({ messages: [[{ role: 'user', content }]] });

// A JPEG, base64-encoded. Images take no task prefix.
export const embedImage = (jpegBase64: string) =>
	run(
		conversation([
			{ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${jpegBase64}` } }
		]),
		TIMEOUT_MS
	);

export const embedText = (text: string) => run({ input: [text] }, TIMEOUT_MS);

export const embedQuery = (query: string) => run({ input: [queryText(query)] }, QUERY_TIMEOUT_MS);
