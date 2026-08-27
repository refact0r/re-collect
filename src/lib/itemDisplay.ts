import { page } from '$app/state';
import type { Id } from '../convex/_generated/dataModel';
import type { DisplayItem } from './types';

// True when the item has a displayable image (uploaded, or completed screenshot)
export function shouldDisplayAsImage(item: DisplayItem): boolean {
	return (
		(item.type === 'image' || (item.type === 'url' && item.screenshotStatus === 'completed')) &&
		!!item.imageUrl
	);
}

// Link that opens the item modal while preserving the current page context
export function getItemUrl(itemId: Id<'items'>): string {
	const params = new URLSearchParams(page.url.searchParams);
	params.set('item', itemId);
	return `${page.url.pathname}?${params}`;
}
