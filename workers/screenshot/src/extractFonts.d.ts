export interface PageFont {
	family: string;
	roles: ('heading' | 'body' | 'mono')[];
	webfont: boolean;
}

export function extractFonts(): Promise<PageFont[]>;
