import { SvelteMap } from 'svelte/reactivity';
import type { Id } from '../convex/_generated/dataModel';

interface CacheEntry {
	url: string;
	expiresAt: number;
}

/**
 * Global in-memory cache for R2 image URLs.
 * Stores URLs with expiration timestamps to avoid unnecessary reloading.
 * URLs are cached for 24 hours (matching the R2 presigned URL expiration).
 */
class ImageCache {
	private cache = new SvelteMap<Id<'items'>, CacheEntry>();
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
