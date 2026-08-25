import { describe, it, expect } from 'vitest';
import { buildSearchText } from './searchText';
import { normalizeTag, dedupePreserveOrder } from '../tagging';

describe('buildSearchText', () => {
	it('joins all populated fields with spaces', () => {
		expect(
			buildSearchText({
				title: 'Poster',
				description: 'a nice poster',
				url: 'https://example.com',
				subject: 'A red poster on a wall',
				styles: ['swiss', 'brutalist'],
				aiTags: ['grid', 'helvetica'],
				paletteNames: ['red', 'crimson']
			})
		).toBe(
			'Poster a nice poster https://example.com A red poster on a wall swiss brutalist grid helvetica red crimson'
		);
	});

	it('skips missing and empty fields', () => {
		expect(buildSearchText({ title: 'Only title' })).toBe('Only title');
		expect(buildSearchText({})).toBe('');
	});
});

describe('normalizeTag', () => {
	it('lowercases and collapses whitespace', () => {
		expect(normalizeTag('  Swiss   Grid ')).toBe('swiss grid');
	});

	it('strips generic trailing modifiers', () => {
		expect(normalizeTag('brutalist aesthetic')).toBe('brutalist');
		expect(normalizeTag('y2k vibes')).toBe('y2k');
	});

	it('strips suffix noise, including hyphenated tails', () => {
		expect(normalizeTag('editorial design')).toBe('editorial');
		expect(normalizeTag('swiss-influenced')).toBe('swiss');
		expect(normalizeTag('typography-driven')).toBe('typography');
	});

	it('keeps standalone suffix-noise words intact', () => {
		expect(normalizeTag('design')).toBe('design');
	});

	it('singularizes plurals but keeps known non-plurals', () => {
		expect(normalizeTag('posters')).toBe('poster');
		expect(normalizeTag('series')).toBe('series');
		expect(normalizeTag('lens')).toBe('lens');
	});
});

describe('dedupePreserveOrder', () => {
	it('removes duplicates and empty strings, keeping first occurrence order', () => {
		expect(dedupePreserveOrder(['b', 'a', 'b', '', 'c', 'a'])).toEqual(['b', 'a', 'c']);
	});
});
