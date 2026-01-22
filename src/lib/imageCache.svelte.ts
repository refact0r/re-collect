import type { Id } from '../convex/_generated/dataModel';

interface CacheEntry {
	url: string;
	expiresAt: number;
}

/**
 * Global in-memory cache for R2 image URLs.
 * Stores URLs with expiration timestamps to avoid unnecessary reloading.
 * URLs are cached for 24 hours (matching the R2 presigned URL expiration).
 *
 * Uses a regular Map (not SvelteMap) since the cache doesn't need to be reactive.
 * Components check the cache when rendering, not when it changes.
 */
class ImageCache {
	private cache = new Map<Id<'items'>, CacheEntry>();
	private readonly CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

	/**
	 * Get a cached URL if it exists and hasn't expired.
	 */
	get(itemId: Id<'items'>): string | undefined {
		const entry = this.cache.get(itemId);
		if (!entry) return undefined;

		// Check if expired
		if (Date.now() >= entry.expiresAt) {
			this.cache.delete(itemId);
			return undefined;
		}

		return entry.url;
	}

	/**
	 * Set a URL in the cache with automatic expiration.
	 */
	set(itemId: Id<'items'>, url: string): void {
		this.cache.set(itemId, {
			url,
			expiresAt: Date.now() + this.CACHE_DURATION
		});
	}

	/**
	 * Remove a specific item from the cache.
	 */
	delete(itemId: Id<'items'>): void {
		this.cache.delete(itemId);
	}

	/**
	 * Clean up expired entries and entries for items no longer in the provided list.
	 */
	cleanup(currentItemIds: Set<Id<'items'>>): void {
		const now = Date.now();
		for (const [itemId, entry] of this.cache.entries()) {
			// Remove if expired or not in current items
			if (now >= entry.expiresAt || !currentItemIds.has(itemId)) {
				this.cache.delete(itemId);
			}
		}
	}

	/**
	 * Clear all cached URLs.
	 */
	clear(): void {
		this.cache.clear();
	}
}

// Export a singleton instance
export const imageCache = new ImageCache();

/**
 * Get an image URL with automatic caching.
 * If the URL is already cached and valid, returns the cached version.
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

	// Check cache first - if we have a valid (non-expired) URL for this item, use it
	// This prevents reloads when different queries return different presigned URLs
	const cached = imageCache.get(itemId);
	if (cached) return cached;

	// Not in cache or expired - cache the new URL and return it
	imageCache.set(itemId, imageUrl);
	return imageUrl;
}
