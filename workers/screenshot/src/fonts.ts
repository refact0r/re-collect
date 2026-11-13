import type { Page } from '@cloudflare/puppeteer';
import { extractFonts, type PageFont } from './extractFonts.js';

export interface SiteFont extends PageFont {
	// Family name from the font file itself (often more canonical than the CSS name)
	internalName?: string;
}

const FONT_TIMEOUT = 8000;

const foldName = (name: string) =>
	name
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]/g, '');

// Of the fonts Chromium actually used for an element, pick the one that
// corresponds to the CSS family (an element can mix fonts)
function pickInternalName(
	family: string,
	used: { familyName: string; isCustomFont: boolean; glyphCount: number }[]
): string | undefined {
	const custom = used.filter((f) => f.isCustomFont && f.familyName.trim());
	if (custom.length === 0) return undefined;
	const key = foldName(family);
	const match = custom.find((f) => {
		const name = foldName(f.familyName);
		return name.includes(key) || key.includes(name) || name.slice(0, 3) === key.slice(0, 3);
	});
	if (match) return match.familyName;
	return custom.length === 1
		? custom[0].familyName
		: custom.reduce((a, b) => (b.glyphCount > a.glyphCount ? b : a)).familyName;
}

// Best effort: font extraction never fails a capture
export async function readFonts(page: Page): Promise<SiteFont[] | undefined> {
	const read = async (): Promise<SiteFont[]> => {
		const fonts: SiteFont[] = await page.evaluate(extractFonts);
		if (!fonts.some((f) => f.webfont)) return fonts;
		const cdp = await page.createCDPSession();
		try {
			await cdp.send('DOM.enable');
			await cdp.send('CSS.enable');
			const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
			for (const [i, font] of fonts.entries()) {
				if (!font.webfont) continue;
				const { nodeId } = await cdp.send('DOM.querySelector', {
					nodeId: root.nodeId,
					selector: `[data-recollect-font="${i}"]`
				});
				if (!nodeId) continue;
				const { fonts: used } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
				font.internalName = pickInternalName(font.family, used);
			}
		} catch (error) {
			console.log('font name lookup failed:', error instanceof Error ? error.message : error);
		} finally {
			await cdp.detach().catch(() => {});
		}
		return fonts;
	};
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			read(),
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new Error('timed out')), FONT_TIMEOUT);
			})
		]);
	} catch (error) {
		console.log('font extraction failed:', error instanceof Error ? error.message : error);
		return undefined;
	} finally {
		clearTimeout(timer);
	}
}
