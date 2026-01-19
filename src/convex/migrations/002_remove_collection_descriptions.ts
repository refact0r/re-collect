import { internalMutation } from '../_generated/server';

// Migration to remove description field from existing collections
export const removeCollectionDescriptions = internalMutation({
	args: {},
	handler: async (ctx) => {
		// Get all collections
		const collections = await ctx.db.query('collections').collect();

		let updatedCount = 0;

		for (const collection of collections) {
			// Check if collection has a description field
			if ('description' in collection) {
				// Create new object without description field
				const { description, ...collectionWithoutDescription } = collection as any;

				// Replace the document with the version without description
				await ctx.db.replace(collection._id, collectionWithoutDescription);
				updatedCount++;
			}
		}

		return { success: true, collectionsUpdated: updatedCount };
	}
});
