import { describe, it, expect } from 'vitest';
import {
	fontDisplayName,
	fontQuery,
	fontSearchKey,
	fontSearchTerms,
	parseSiteFonts,
	type SiteFont
} from './fonts';

const font = (family: string, internalName?: string): SiteFont => ({
	family,
	internalName,
	roles: [],
	webfont: true
});

describe('fontDisplayName', () => {
	// Real pairs from the prototype run (experiments/design-tokens)
	it('prefers the font file’s name over a cryptic CSS alias', () => {
		expect(fontDisplayName(font('fhd', 'FH Dfaalt'))).toBe('FH Dfaalt');
		expect(fontDisplayName(font('areal', 'ABC Areal Superfamily Variable'))).toBe(
			'ABC Areal Superfamily'
		);
		expect(fontDisplayName(font('SOEHNE', 'Söhne'))).toBe('Söhne');
		expect(fontDisplayName(font('cinetype', 'GT Cinetype'))).toBe('GT Cinetype');
	});

	it('strips weight and format suffixes', () => {
		expect(fontDisplayName(font('denim', 'Denim SemiBold'))).toBe('Denim');
		expect(fontDisplayName(font('muoto', 'Muoto VAR'))).toBe('Muoto');
		expect(fontDisplayName(font('GT America Mono Light'))).toBe('GT America Mono');
		expect(fontDisplayName(font('Editor-Regular'))).toBe('Editor');
		expect(fontDisplayName(font('Source Code Pro', 'Source Code Pro ExtraLight'))).toBe(
			'Source Code Pro'
		);
	});

	it('keeps style words that start a family name', () => {
		expect(fontDisplayName(font('Black Han Sans'))).toBe('Black Han Sans');
	});

	it('falls back to the CSS name when the internal name is junk', () => {
		expect(fontDisplayName(font('sohne-var', 'Copyright Klim Type Foundry'))).toBe('Sohne');
	});

	it('splits run-together names and tidies casing', () => {
		expect(fontDisplayName(font('GT AMERICA'))).toBe('GT America');
		expect(fontDisplayName(font('HelveticaNeue'))).toBe('Helvetica Neue');
		expect(fontDisplayName(font('JetBrains Mono'))).toBe('JetBrains Mono');
		expect(fontDisplayName(font('SOEHNE IKON'))).toBe('Soehne Ikon');
		expect(fontDisplayName(font('PP Neue Montreal'))).toBe('PP Neue Montreal');
	});
});

// Search is case-insensitive, so terms are compared lowercased
const lowered = (fonts: SiteFont[]) => fontSearchTerms(fonts).map((t) => t.toLowerCase());

describe('fontSearchTerms', () => {
	it('includes spaced, accent-free and one-word forms of every name', () => {
		expect(lowered([font('SOEHNE', 'Söhne')])).toEqual(['fontsohne', 'söhne', 'sohne', 'soehne']);
	});

	it('makes cryptic CSS aliases searchable alongside the real name', () => {
		expect(lowered([font('areal', 'ABC Areal Superfamily Variable')])).toEqual([
			'fontabcarealsuperfamily',
			'abc areal superfamily',
			'abcarealsuperfamily',
			'areal'
		]);
	});

	it('dedupes case-insensitively and handles no fonts', () => {
		expect(fontSearchTerms([font('Inter', 'Inter')])).toEqual(['fontinter', 'Inter']);
		expect(fontSearchTerms(undefined)).toEqual([]);
	});
});

describe('fontQuery', () => {
	it('is one font-prefixed token, so it never prefix-matches ordinary words', () => {
		expect(fontQuery(font('Inter', 'Inter Variable'))).toBe('fontinter');
		expect(fontQuery(font('GT America Mono Light'))).toBe('fontgtamericamono');
	});
});

describe('fontSearchKey', () => {
	it('folds spacing, case and accents into one token', () => {
		expect(fontSearchKey('GT America Mono')).toBe('gtamericamono');
		expect(fontSearchKey('Söhne')).toBe('sohne');
	});
});

describe('parseSiteFonts', () => {
	it('keeps well-formed entries and drops the rest', () => {
		expect(
			parseSiteFonts([
				{ family: 'Inter', roles: ['body', 'bogus'], webfont: true, internalName: '' },
				{ family: '' },
				'nope',
				{ family: 'Helvetica', internalName: 'Helvetica Neue' }
			])
		).toEqual([
			{ family: 'Inter', roles: ['body'], webfont: true },
			{ family: 'Helvetica', internalName: 'Helvetica Neue', roles: [], webfont: false }
		]);
	});

	it('merges families that differ only by weight', () => {
		expect(
			parseSiteFonts([
				{ family: 'Editor-Regular', roles: ['body'], webfont: true },
				{ family: 'GT America Mono Light', roles: ['mono'], webfont: true },
				{ family: 'Editor-Bold', roles: ['heading'], webfont: true }
			])
		).toEqual([
			{ family: 'Editor-Regular', roles: ['heading', 'body'], webfont: true },
			{ family: 'GT America Mono Light', roles: ['mono'], webfont: true }
		]);
	});

	it('returns undefined when the worker sent no fonts', () => {
		expect(parseSiteFonts(undefined)).toBeUndefined();
	});
});
