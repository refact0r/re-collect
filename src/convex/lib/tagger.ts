// The LLM boundary shared by both tagging modes: prompts, the OpenRouter call,
// and parsing + validating its output into normalized tags. Holds no Convex
// functions, so the Node actions and plain specs can both import it.

const PROMPT_VERSION = 'v5';
const TEXT_PROMPT_VERSION = 'text-v3';
// Luna adopted 2026-08-28 after the round-2 bake-off (experiments/tagging/
// model-comparison-2026-08-round2.md): GPT-5.6 Luna beat qwen3.7-flash on
// style accuracy and OCR in both tagging modes. Moved to GPT-6 Luna on
// 2026-10-30, at about half the price.
const DEFAULT_MODEL = 'openai/gpt-6-luna';
const TEMPERATURE = 0.3;
const MAX_TOKENS = 600;
const TIMEOUT_MS = 60_000;
const RETRY_BACKOFF_MS = [1000, 3000]; // one per retry, after the initial attempt
export const MAX_ERROR_CHARS = 500;

// Ported byte-for-byte from experiments/tagging/tag_qwen.py.
const PROMPT = `You are tagging an image for a personal visual reference library. The image is typically an artwork or illustration, a graphic design piece, a screenshot of a website or digital interface, or a photograph. Your job is to produce structured tags so the user can rediscover this item later. Aesthetic style is the primary axis — spend the most thought there. Also capture the literal content (subject, concrete tags), since those help recall too.

Return ONLY a JSON object matching this schema. No prose, no markdown fences.

{
  "styles": string[],    // PRIMARY FIELD. 2-8 specific aesthetic/genre labels — the categories this image belongs to.
  "subject": string,     // one sentence under 30 words — what's depicted at a glance, not an exhaustive description.
  "tags": string[]       // 5-12 concrete observations, 1-4 words each — specific objects, materials, motifs, technical details the user could later search for. Distinct from styles; do not duplicate.
}

Style vocabulary guidance (inspirational, not prescriptive):
- Design / web movements: brutalist, swiss, international typographic, memphis, y2k, vaporwave, post-internet, skeuomorphic, neumorphism, glassmorphism, terminal, ascii.
- Art movements: art deco, art nouveau, bauhaus, constructivist, cubist, surrealist, expressionist, mid-century modern, ukiyo-e, gothic, baroque.
- Illustration / digital: anime, manga, lo-fi, concept art, low-poly, ps1, ps2, pixel art, vector flat, isometric, risograph, halftone, zine, editorial illustration.
- Photographic: documentary, street, portrait, fashion editorial, still life, film grain, polaroid, lomography.
- General descriptors: minimalist, maximalist, monochrome, high-contrast, hand-drawn, generative, glitch, surreal.
DO NOT pick a label merely because it appears in the list above. If none of these fit, propose a more accurate label. If something clearly fits, use it.

Rules:
- Do NOT name specific artists, designers, studios, or brands unless their identity is unambiguous from a visible signature, logo, or watermark in the image.
- For each style, pick the label that most accurately describes the image — neither broader nor narrower than the image warrants.
- If the image contains text that would itself act as a distinct/memorable search anchor later — a title, headline, signage with real content, distinctive graffiti, or a brand/product name — include up to 3 of them as tags (a text anchor may exceed the word cap, but keep it a short phrase). Skip generic UI chrome, serial numbers, version strings, and any text that isn't recognizable out of context.
`;

// Text-mode prompt: articles get a summary + topic tags instead of visual
// style tagging. Output feeds the same subject/aiTags fields.
const TEXT_PROMPT = `You are tagging a saved web article for a personal reference library. Based on the article text below, produce genre labels, a summary, and topic tags so the user can rediscover this item later via search.

Return ONLY a JSON object matching this schema. No prose, no markdown fences.

{
  "styles": string[],  // 1-4 high-level genre labels — the form of the piece and the field(s) it belongs to.
  "subject": string,   // one sentence under 30 words — what the article is about.
  "tags": string[]     // 5-12 topic tags, 1-4 words each, lowercase — subjects, technologies, people, places, concepts covered that the user might search for later. Distinct from styles; do not duplicate.
}

Style vocabulary guidance (inspirational, not prescriptive):
- Form: personal essay, tutorial, interview, retrospective, case study, academic paper, documentation, manifesto, review, talk transcript.
- Field: design criticism, typography, software engineering, web design, photography, architecture, career advice.

Rules:
- NEVER use generic labels in styles or tags — no "blog post", "article", "writing", "technology". Pick the specific form and specific topics.
- Include proper nouns (products, companies, people) that are central to the piece, and the author's name if identifiable.
- The article text may be truncated. The subject may describe the piece's overall scope as stated or implied; tags must come only from content actually present.`;

// Words ending in -s that aren't actually plurals, plus proper nouns the
// models emit that a naive singularizer would mangle (climeworks →
// "climework"). Add as we find more false positives.
const KEEP_PLURAL = new Set([
	'lens',
	'iris',
	'series',
	'species',
	'analysis',
	'axis',
	'chaos',
	'climeworks',
	'beaux-arts'
]);
const GENERIC_MODIFIERS = new Set(['aesthetic', 'style', 'vibes', 'vibe']);
// Words that are noise as a suffix — either as a trailing space-separated
// word ("editorial design" → "editorial") or as a hyphenated tail
// ("swiss-influenced" → "swiss", "typography-driven" → "typography"). They
// remain meaningful as standalone single-word tags, so only stripped when
// attached.
const SUFFIX_NOISE = new Set(['design', 'influenced', 'driven', 'based', 'heavy']);

function singularizeWord(w: string): string {
	if (w.length <= 3 || KEEP_PLURAL.has(w)) return w;
	if (w.endsWith('ss') || w.endsWith('us') || w.endsWith('is') || w.endsWith('os')) return w;
	if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y';
	if (w.endsWith('ves') && w.length > 4) return w.slice(0, -3) + 'f';
	if (
		w.endsWith('ses') ||
		w.endsWith('xes') ||
		w.endsWith('zes') ||
		w.endsWith('ches') ||
		w.endsWith('shes')
	) {
		return w.slice(0, -2);
	}
	if (w.endsWith('s')) return w.slice(0, -1);
	return w;
}

export function normalizeTag(s: string): string {
	let out = s.toLowerCase().split(/\s+/).filter(Boolean).join(' ');
	out = out.replace(/^[.,;:!?"'`]+|[.,;:!?"'`]+$/g, '');
	if (!out) return out;
	const words = out.split(' ');
	while (
		words.length > 1 &&
		(GENERIC_MODIFIERS.has(words[words.length - 1]) || SUFFIX_NOISE.has(words[words.length - 1]))
	) {
		words.pop();
	}
	if (words.length > 0) {
		const last = words[words.length - 1];
		for (const suffix of SUFFIX_NOISE) {
			const ending = `-${suffix}`;
			if (last.endsWith(ending) && last.length > ending.length) {
				words[words.length - 1] = last.slice(0, -ending.length);
				break;
			}
		}
	}
	// Singularize only the head noun. Interior plural words are usually part
	// of proper names or compounds ("substans conference", "systems design")
	// where singularizing corrupts the search anchor.
	words[words.length - 1] = singularizeWord(words[words.length - 1]);
	return words.join(' ');
}

export function dedupePreserveOrder(items: string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const x of items) {
		if (x && !seen.has(x)) {
			seen.add(x);
			out.push(x);
		}
	}
	return out;
}

export function parseJsonLenient(s: string): unknown {
	let str = s.trim();
	if (str.startsWith('```')) {
		str = str.replace(/^`+/, '');
		if (str.startsWith('json')) str = str.slice(4);
		str = str.replace(/`+$/, '').trim();
	}
	const i = str.indexOf('{');
	const j = str.lastIndexOf('}');
	if (i === -1 || j === -1) throw new Error('no JSON object found in response');
	return JSON.parse(str.slice(i, j + 1));
}

export type Tags = { styles: string[]; subject: string; aiTags: string[] };

function tagList(value: unknown, field: string, min: number): string[] {
	if (!Array.isArray(value) || value.length < min) {
		throw new Error(`${field} must have at least ${min} ${min === 1 ? 'entry' : 'entries'}`);
	}
	if (!value.every((s) => typeof s === 'string' && s.trim())) {
		throw new Error(`${field} entries must be non-empty strings`);
	}
	return dedupePreserveOrder(value.map((s: string) => normalizeTag(s)));
}

// Schema check + normalization; remaps the model's `tags` to `aiTags`, minus
// any entry already in `styles`
export function validateTags(d: unknown, maxStyles: number): Tags {
	if (!d || typeof d !== 'object' || Array.isArray(d)) throw new Error('not an object');
	const obj = d as Record<string, unknown>;

	const styles = tagList(obj.styles, 'styles', 1).slice(0, maxStyles);
	if (typeof obj.subject !== 'string' || !obj.subject.trim()) {
		throw new Error('subject must be non-empty string');
	}
	const styleSet = new Set(styles);
	const aiTags = tagList(obj.tags, 'tags', 3)
		.filter((t) => !styleSet.has(t))
		.slice(0, 12);

	return { styles, subject: obj.subject.trim(), aiTags };
}

// Returns the raw completion content; throws on transport/API errors and
// empty responses
async function openRouterChat(
	apiKey: string,
	model: string,
	content: unknown,
	logLabel: string
): Promise<string> {
	const payload = {
		model,
		messages: [{ role: 'user', content }],
		temperature: TEMPERATURE,
		max_tokens: MAX_TOKENS,
		response_format: { type: 'json_object' },
		// Reasoning disabled: matrix sweep (4 images × 6 treatments × 3
		// trials) showed reasoning drifts the model away from specific
		// named-movement labels and reduces stability across re-tags.
		reasoning: { enabled: false }
	};

	// The signal also bounds reading the body, not just the headers
	const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${apiKey}`,
			'Content-Type': 'application/json',
			'HTTP-Referer': 'http://localhost/re-collect',
			'X-Title': 're-collect tag pipeline'
		},
		body: JSON.stringify(payload),
		signal: AbortSignal.timeout(TIMEOUT_MS)
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`OpenRouter ${response.status}: ${text.slice(0, MAX_ERROR_CHARS)}`);
	}

	const body = (await response.json()) as {
		choices?: Array<{ message?: { content: string | null }; finish_reason?: string }>;
		usage?: unknown;
	};

	const choice = body.choices?.[0];
	const reply = choice?.message?.content;
	if (!reply) {
		throw new Error(`empty content; finish_reason=${choice?.finish_reason ?? 'unknown'}`);
	}

	console.log(`tagging usage for ${logLabel}:`, JSON.stringify(body.usage ?? null));
	return reply;
}

export type TagResult = Tags & { modelVersion: string };

export function requestImageTags(jpegBase64: string, logLabel: string): Promise<TagResult> {
	const content = [
		{ type: 'text', text: PROMPT },
		{ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${jpegBase64}` } }
	];
	return requestTags(content, PROMPT_VERSION, 8, logLabel);
}

export function requestArticleTags(
	article: { title?: string; url: string; text: string },
	logLabel: string
): Promise<TagResult> {
	const input = [
		article.title ? `Title: ${article.title}` : null,
		`URL: ${article.url}`,
		'',
		article.text
	]
		.filter((line) => line !== null)
		.join('\n');
	return requestTags(`${TEXT_PROMPT}\n\n${input}`, TEXT_PROMPT_VERSION, 4, logLabel);
}

// One call + parse + validate, retried on transport, parse, and schema
// failures alike — temperature > 0 means a re-roll can succeed, and provider
// blips (429/502) are common enough that a single attempt fails items
// needlessly.
async function requestTags(
	content: unknown,
	promptVersion: string,
	maxStyles: number,
	logLabel: string
): Promise<TagResult> {
	const apiKey = process.env.OPENROUTER_API_KEY;
	if (!apiKey) throw new Error('OPENROUTER_API_KEY not configured');
	const model = process.env.TAGGING_MODEL ?? DEFAULT_MODEL;

	let lastError: unknown;
	for (let attempt = 0; attempt <= RETRY_BACKOFF_MS.length; attempt++) {
		if (attempt > 0) {
			await new Promise((resolve) => setTimeout(resolve, RETRY_BACKOFF_MS[attempt - 1]));
		}
		try {
			const raw = await openRouterChat(apiKey, model, content, logLabel);
			const tags = validateTags(parseJsonLenient(raw), maxStyles);
			return { ...tags, modelVersion: `${model}:${promptVersion}` };
		} catch (error) {
			lastError = error;
			console.warn(`tagging attempt ${attempt + 1} failed for ${logLabel}:`, error);
		}
	}
	throw lastError;
}
