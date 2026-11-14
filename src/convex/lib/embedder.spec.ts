import { describe, it, expect } from 'vitest';
import { documentText, embeddingInput, inputKey, queryText } from './embedder';

describe('embeddingInput', () => {
	it('embeds an image item, or a visual link with its image, as pixels', () => {
		expect(embeddingInput({ type: 'image', imageKey: 'a.jpg' })).toEqual({
			kind: 'image',
			imageKey: 'a.jpg'
		});
		expect(
			embeddingInput({ type: 'url', imageKey: 'b.webp', screenshotStatus: 'completed' })
		).toEqual({ kind: 'image', imageKey: 'b.webp' });
	});

	it('waits for a link’s capture to land, first or redone', () => {
		expect(embeddingInput({ type: 'url', title: 'x', screenshotStatus: 'pending' })).toBeNull();
		expect(
			embeddingInput({ type: 'url', imageKey: 'old.webp', screenshotStatus: 'pending' })
		).toBeNull();
	});

	it('falls back to text when a link never got an image', () => {
		expect(
			embeddingInput({ type: 'url', title: 'Site', screenshotStatus: 'failed' })
		).toMatchObject({ kind: 'text' });
	});

	it('embeds text-mode links as words, once their tags are in', () => {
		const article = {
			type: 'url' as const,
			title: 'On grids',
			imageKey: 'c.webp',
			taggingMode: 'text' as const
		};
		expect(embeddingInput({ ...article, taggingStatus: 'pending' })).toBeNull();
		expect(embeddingInput({ ...article, taggingStatus: 'completed' })).toMatchObject({
			kind: 'text'
		});
	});

	it('embeds notes as words', () => {
		expect(embeddingInput({ type: 'text', title: 'n', content: 'c' })).toEqual({
			kind: 'text',
			text: 'title: n | text: c'
		});
	});
});

describe('documentText', () => {
	it('uses EmbeddingGemma’s document format, with title: none when untitled', () => {
		expect(
			documentText({
				subject: 'A grid essay',
				aiTags: ['grids', 'layout'],
				url: 'https://www.a.com/x'
			})
		).toBe('title: none | text: A grid essay\ngrids, layout\na.com');
	});
});

describe('queryText', () => {
	it('adds the search task prefix', () => {
		expect(queryText('  red posters ')).toBe('task: search result | query: red posters');
	});
});

describe('inputKey', () => {
	it('changes with the input and not otherwise', async () => {
		expect(await inputKey({ kind: 'image', imageKey: 'a.jpg' })).toBe('image:a.jpg');
		const a = await inputKey({ kind: 'text', text: 'one' });
		expect(a).toMatch(/^text:[0-9a-f]{32}$/);
		expect(await inputKey({ kind: 'text', text: 'one' })).toBe(a);
		expect(await inputKey({ kind: 'text', text: 'two' })).not.toBe(a);
	});
});
