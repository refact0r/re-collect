import { v } from 'convex/values';
import { internalAction, internalMutation, internalQuery, mutation } from './_generated/server';
import { internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import { requireAuth } from './lib/auth';
import { buildSearchText } from './lib/searchText';
import { colorNamesForPalette } from './lib/colorNames';

const PROMPT_VERSION = 'v4';
const DEFAULT_MODEL = 'qwen/qwen3.7-flash';
const TEMPERATURE = 0.3;
const MAX_TOKENS = 600;
const TIMEOUT_MS = 60_000;

// Ported byte-for-byte from experiments/tagging/tag_qwen.py.
const PROMPT = `You are tagging an image for a personal visual reference library. The image will be one of: an artwork or illustration, a graphic design piece, a screenshot of a website or digital interface, or a photograph. Your job is to produce structured tags so the user can rediscover this item later. Aesthetic style is the primary axis — spend the most thought there. Also capture the literal content (subject, concrete tags), since those help recall too.

Return ONLY a JSON object matching this schema. No prose, no markdown fences.

{
  "styles": string[],    // PRIMARY FIELD. 2-8 specific aesthetic/genre labels — what categories does this belong to.
  "subject": string,     // one sentence under 30 words — what's depicted at a glance, not an exhaustive description.
  "tags": string[]       // 5-12 concrete observations — specific objects, materials, motifs, technical details that the user could later search for. Distinct from styles; do not duplicate.
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
- If the image contains text that would itself act as a distinct/memorable search anchor later — a title, headline, signage with real content, distinctive graffiti, or a brand/product name — include up to 3 of them as tags (no longer than a short phrase). Skip generic UI chrome, serial numbers, version strings, and any text that isn't recognizable out of context.
`;

// Words ending in -s that aren't actually plurals.
const KEEP_PLURAL = new Set(['lens', 'iris', 'series', 'species', 'analysis', 'axis', 'chaos']);
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
	return words.map(singularizeWord).join(' ');
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

export class TagSchemaError extends Error {}

function parseJsonLenient(s: string): unknown {
	let str = s.trim();
	if (str.startsWith('```')) {
		str = str.replace(/^`+/, '');
		if (str.startsWith('json')) str = str.slice(4);
		str = str.replace(/`+$/, '').trim();
	}
	const i = str.indexOf('{');
	const j = str.lastIndexOf('}');
	if (i === -1 || j === -1) throw new TagSchemaError('no JSON object found in response');
	return JSON.parse(str.slice(i, j + 1));
}

type ValidatedTags = {
	styles: string[];
	subject: string;
	aiTags: string[];
};

function validateTags(d: unknown): ValidatedTags {
	if (!d || typeof d !== 'object' || Array.isArray(d)) {
		throw new TagSchemaError('not an object');
	}
	const obj = d as Record<string, unknown>;

	const stylesRaw = obj.styles;
	if (!Array.isArray(stylesRaw) || stylesRaw.length < 1) {
		throw new TagSchemaError('styles must have at least 1 entry');
	}
	if (!stylesRaw.every((s) => typeof s === 'string' && s.trim())) {
		throw new TagSchemaError('styles entries must be non-empty strings');
	}
	const styles = dedupePreserveOrder(stylesRaw.map((s) => normalizeTag(s as string))).slice(0, 8);

	const subjectRaw = obj.subject;
	if (typeof subjectRaw !== 'string' || !subjectRaw.trim()) {
		throw new TagSchemaError('subject must be non-empty string');
	}
	const subject = subjectRaw.trim();

	const tagsRaw = obj.tags;
	if (!Array.isArray(tagsRaw) || tagsRaw.length < 3) {
		throw new TagSchemaError('tags must have at least 3 entries');
	}
	if (!tagsRaw.every((t) => typeof t === 'string' && t.trim())) {
		throw new TagSchemaError('tags entries must be non-empty strings');
	}
	const styleSet = new Set(styles);
	const aiTags = dedupePreserveOrder(tagsRaw.map((t) => normalizeTag(t as string)))
		.filter((t) => !styleSet.has(t))
		.slice(0, 12);

	return {
		styles,
		subject,
		aiTags
	};
}

export const getItemForTagging = internalQuery({
	args: { itemId: v.id('items') },
	handler: async (ctx, args): Promise<Doc<'items'> | null> => {
		return await ctx.db.get(args.itemId);
	}
});

export const setProcessing = internalMutation({
	args: { itemId: v.id('items') },
	handler: async (ctx, args) => {
		const item = await ctx.db.get(args.itemId);
		if (!item) return;
		await ctx.db.patch(args.itemId, {
			taggingStatus: 'processing'
		});
	}
});

export const setCompleted = internalMutation({
	args: {
		itemId: v.id('items'),
		styles: v.array(v.string()),
		subject: v.string(),
		aiTags: v.array(v.string()),
		modelVersion: v.string()
	},
	handler: async (ctx, args) => {
		const item = await ctx.db.get(args.itemId);
		if (!item) return;
		await ctx.db.patch(args.itemId, {
			taggingStatus: 'completed',
			styles: args.styles,
			subject: args.subject,
			aiTags: args.aiTags,
			taggingModelVersion: args.modelVersion,
			taggingError: undefined,
			searchText: buildSearchText({
				title: item.title,
				description: item.description,
				url: item.url,
				styles: args.styles,
				aiTags: args.aiTags,
				subject: args.subject,
				paletteNames: item.paletteNames
			})
		});
	}
});

export const setFailed = internalMutation({
	args: {
		itemId: v.id('items'),
		error: v.string()
	},
	handler: async (ctx, args) => {
		const item = await ctx.db.get(args.itemId);
		if (!item) return;
		await ctx.db.patch(args.itemId, {
			taggingStatus: 'failed',
			taggingError: args.error
		});
	}
});

export const setPaletteHex = internalMutation({
	args: { itemId: v.id('items'), paletteHex: v.array(v.string()) },
	handler: async (ctx, args) => {
		const item = await ctx.db.get(args.itemId);
		if (!item) return;
		const paletteNames = colorNamesForPalette(args.paletteHex);
		await ctx.db.patch(args.itemId, {
			paletteHex: args.paletteHex,
			paletteNames,
			searchText: buildSearchText({
				title: item.title,
				description: item.description,
				url: item.url,
				styles: item.styles,
				aiTags: item.aiTags,
				subject: item.subject,
				paletteNames
			})
		});
	}
});

export const callOpenRouter = internalAction({
	args: {
		itemId: v.id('items'),
		downscaledBase64: v.string(),
		mime: v.string()
	},
	handler: async (ctx, args): Promise<void> => {
		const apiKey = process.env.OPENROUTER_API_KEY;
		if (!apiKey) {
			await ctx.runMutation(internal.tagging.setFailed, {
				itemId: args.itemId,
				error: 'OPENROUTER_API_KEY not configured'
			});
			return;
		}

		const model = process.env.TAGGING_MODEL ?? DEFAULT_MODEL;
		const dataUrl = `data:${args.mime};base64,${args.downscaledBase64}`;

		const payload = {
			model,
			messages: [
				{
					role: 'user',
					content: [
						{ type: 'text', text: PROMPT },
						{ type: 'image_url', image_url: { url: dataUrl } }
					]
				}
			],
			temperature: TEMPERATURE,
			max_tokens: MAX_TOKENS,
			response_format: { type: 'json_object' },
			// Reasoning disabled: matrix sweep (4 images × 6 treatments × 3
			// trials) showed reasoning drifts the model away from specific
			// named-movement labels and reduces stability across re-tags.
			reasoning: { enabled: false }
		};

		try {
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
			let response: Response;
			try {
				response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
					method: 'POST',
					headers: {
						Authorization: `Bearer ${apiKey}`,
						'Content-Type': 'application/json',
						'HTTP-Referer': 'http://localhost/re-collect',
						'X-Title': 're-collect tag pipeline'
					},
					body: JSON.stringify(payload),
					signal: controller.signal
				});
			} finally {
				clearTimeout(timeoutId);
			}

			if (!response.ok) {
				const text = await response.text();
				throw new Error(`OpenRouter ${response.status}: ${text}`);
			}

			const body = (await response.json()) as {
				choices: Array<{
					message: { content: string | null };
					finish_reason?: string;
				}>;
				usage?: unknown;
			};

			const content = body.choices?.[0]?.message?.content;
			if (!content) {
				throw new Error(
					`empty content; finish_reason=${body.choices?.[0]?.finish_reason ?? 'unknown'}`
				);
			}

			const parsed = parseJsonLenient(content);
			const validated = validateTags(parsed);

			console.log(`tagging usage for ${args.itemId}:`, JSON.stringify(body.usage ?? null));

			await ctx.runMutation(internal.tagging.setCompleted, {
				itemId: args.itemId,
				styles: validated.styles,
				subject: validated.subject,
				aiTags: validated.aiTags,
				modelVersion: `${model}:${PROMPT_VERSION}`
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			await ctx.runMutation(internal.tagging.setFailed, {
				itemId: args.itemId,
				error: message
			});
		}
	}
});

export const retagItem = mutation({
	args: { itemId: v.id('items'), token: v.optional(v.string()) },
	handler: async (ctx, args) => {
		requireAuth(args.token);
		const item = await ctx.db.get(args.itemId);
		if (!item) throw new Error('Item not found');
		if (item.type === 'text') throw new Error('Text items cannot be tagged');
		if (!item.imageKey) throw new Error('Item has no image to tag');
		if (item.taggingStatus === 'processing' || item.taggingStatus === 'pending') {
			throw new Error('Tagging already in progress');
		}
		// Don't tag an image that's about to be replaced; the new image
		// schedules its own tagging (or palette) when it lands
		if (item.screenshotStatus === 'pending' || item.screenshotStatus === 'processing') {
			throw new Error('Image fetch in progress; wait for it to finish');
		}

		// Manually tagging an item opts it into tagging for future re-images
		await ctx.db.patch(args.itemId, {
			taggingMode: 'visual',
			taggingStatus: 'pending',
			taggingError: undefined
		});

		await ctx.scheduler.runAfter(0, internal.taggingActions.preprocessItem, {
			itemId: args.itemId
		});
	}
});
