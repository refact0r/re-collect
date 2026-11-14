import { describe, expect, test } from 'vitest';
import { parseJsonLenient, validateTags } from './tagger';

describe('parseJsonLenient', () => {
	test('parses a bare object', () => {
		expect(parseJsonLenient('{"a": 1}')).toEqual({ a: 1 });
	});

	test('strips markdown fences and surrounding prose', () => {
		expect(parseJsonLenient('```json\n{"a": 1}\n```')).toEqual({ a: 1 });
		expect(parseJsonLenient('Here you go: {"a": {"b": 2}} hope that helps')).toEqual({
			a: { b: 2 }
		});
	});

	test('throws when there is no object', () => {
		expect(() => parseJsonLenient('no json here')).toThrow('no JSON object');
		expect(() => parseJsonLenient('{"a": }')).toThrow();
	});
});

describe('validateTags', () => {
	const valid = {
		styles: ['Brutalist aesthetic', 'swiss', 'brutalist'],
		subject: '  A poster  ',
		tags: ['posters', 'swiss', 'grid', 'Helvetica']
	};

	test('normalizes, dedupes, trims and remaps tags to aiTags', () => {
		expect(validateTags(valid, 8)).toEqual({
			styles: ['brutalist', 'swiss'],
			subject: 'A poster',
			aiTags: ['poster', 'grid', 'helvetica']
		});
	});

	test('caps styles at the given limit and aiTags at 12', () => {
		const styles = ['a1', 'b1', 'c1', 'd1', 'e1', 'f1'];
		const tags = Array.from({ length: 20 }, (_, i) => `tag${i}`);
		const result = validateTags({ ...valid, styles, tags }, 4);
		expect(result.styles).toEqual(['a1', 'b1', 'c1', 'd1']);
		expect(result.aiTags).toHaveLength(12);
	});

	test.each([
		['a non-object', ['x'], 'not an object'],
		['missing styles', { ...valid, styles: [] }, 'styles must have at least 1 entry'],
		['a blank style', { ...valid, styles: [' '] }, 'styles entries must be non-empty strings'],
		['a blank subject', { ...valid, subject: ' ' }, 'subject must be non-empty string'],
		['too few tags', { ...valid, tags: ['a', 'b'] }, 'tags must have at least 3 entries'],
		[
			'a non-string tag',
			{ ...valid, tags: ['a', 'b', 3] },
			'tags entries must be non-empty strings'
		]
	])('rejects %s', (_, input, message) => {
		expect(() => validateTags(input, 8)).toThrow(message);
	});
});
