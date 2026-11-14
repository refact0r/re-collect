import { describe, it, expect } from 'vitest';
import {
	fontDisplayName,
	fontQuery,
	fontSearchKey,
	fontSearchTerms,
	parseSiteFonts,
	type SiteFont
} from './fonts';

const font = (family: string, internalName?: string): SiteFont => ({ family, internalName });

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

	it('keeps the Roman in Times New Roman but strips a Roman cut', () => {
		expect(fontDisplayName(font('Times New Roman'))).toBe('Times New Roman');
		expect(fontDisplayName(font('TimesNewRoman'))).toBe('Times New Roman');
		expect(fontDisplayName(font('Times New Roman Bold'))).toBe('Times New Roman');
		expect(fontDisplayName(font('Tiempos Text Roman'))).toBe('Tiempos Text');
		expect(fontSearchTerms([font('TimesNewRoman')])).toContain('timesnewroman');
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

	it('never indexes a hashed family', () => {
		expect(fontSearchTerms([font('3b2802a0'), font('a1b2c3', 'Copyright Klim')])).toEqual([]);
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
				{ family: 'Inter', internalName: '' },
				{ family: '' },
				'nope',
				{ family: 'Helvetica', internalName: 'Helvetica Neue', roles: ['body'] }
			])
		).toEqual([{ family: 'Inter' }, { family: 'Helvetica', internalName: 'Helvetica Neue' }]);
	});

	it('collapses families that differ only by weight', () => {
		expect(
			parseSiteFonts([
				{ family: 'Editor-Regular' },
				{ family: 'GT America Mono Light' },
				{ family: 'Editor-Bold' }
			])
		).toEqual([{ family: 'Editor-Regular' }, { family: 'GT America Mono Light' }]);
	});

	it('drops fonts with no usable name, but not hex-looking words', () => {
		expect(
			parseSiteFonts([
				{ family: '3b2802a0' },
				{ family: 'f00ba4', internalName: '' },
				{ family: 'Facade' }
			])
		).toEqual([{ family: 'Facade' }]);
	});

	it('keeps at most 5 fonts', () => {
		const raw = ['A1', 'B2', 'C3', 'D4', 'E5', 'F6'].map((family) => ({ family }));
		expect(parseSiteFonts(raw)).toHaveLength(5);
	});

	it('returns undefined when the worker sent no fonts', () => {
		expect(parseSiteFonts(undefined)).toBeUndefined();
	});
});
