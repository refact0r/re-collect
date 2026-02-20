import type { Id } from '../convex/_generated/dataModel';

/**
 * Global in-memory cache for R2 image URLs.
 * Prevents unnecessary image reloads when navigating between pages,
 * since R2 presigned URLs have unique signatures each time they're generated.
 *
 * Uses a regular Map (not SvelteMap) since the cache doesn't need to be reactive.
 * Components check the cache when rendering, not when it changes.
 */
class ImageCache {
	private cache = new Map<Id<'items'>, string>();

	get(itemId: Id<'items'>): string | undefined {
		return this.cache.get(itemId);
	}

	set(itemId: Id<'items'>, url: string): void {
		this.cache.set(itemId, url);
	}

	delete(itemId: Id<'items'>): void {
		this.cache.delete(itemId);
	}

	/**
	 * Remove entries for items no longer in the provided list.
	 */
	cleanup(currentItemIds: Set<Id<'items'>>): void {
		for (const itemId of this.cache.keys()) {
			if (!currentItemIds.has(itemId)) {
				this.cache.delete(itemId);
			}
		}
	}

	clear(): void {
		this.cache.clear();
	}
}

// Export a singleton instance
export const imageCache = new ImageCache();

/**
 * Get an image URL with automatic caching.
 * If the URL is already cached, returns the cached version.
 * Otherwise, caches the URL and returns it.
 *
 * This is the primary interface for accessing images - components should
 * use this instead of directly accessing the cache.
 *
 * Note: R2 presigned URLs have unique signatures each time they're generated,
 * so we cache by itemId alone (not comparing URLs). This prevents unnecessary
 * reloads when navigating between pages that fetch item data independently.
 */
export function getImage(itemId: Id<'items'>, imageUrl: string | null | undefined): string | undefined {
	if (!imageUrl) return undefined;

	const cached = imageCache.get(itemId);
	if (cached) return cached;

	imageCache.set(itemId, imageUrl);
	return imageUrl;
}
