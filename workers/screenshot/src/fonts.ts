import type { Page } from '@cloudflare/puppeteer';
import { extractFonts } from './extractFonts.js';
import { pickInternalName } from './lib.js';

export interface SiteFont {
	// First declared CSS font-family
	family: string;
	// Family name from the font file itself (often more canonical than the CSS name);
	// absent for system fonts
	internalName?: string;
}

const FONT_TIMEOUT = 8000;

// Best effort: font extraction never fails a capture
export async function readFonts(page: Page): Promise<SiteFont[] | undefined> {
	const read = async (): Promise<SiteFont[]> => {
		const fonts: SiteFont[] = (await page.evaluate(extractFonts)).map((family) => ({ family }));
		if (!fonts.length) return fonts;
		const cdp = await page.createCDPSession();
		try {
			await cdp.send('DOM.enable');
			await cdp.send('CSS.enable');
			const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
			for (const [i, font] of fonts.entries()) {
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
