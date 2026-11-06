import { v } from 'convex/values';
import { internalAction, internalMutation } from './_generated/server';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { hashCode, userQuery } from './lib/auth';

// Validates an access code (login page, actions that check the caller first)
export const me = userQuery({
	args: {},
	handler: async (ctx) => {
		const user = await ctx.db.get(ctx.userId);
		return { name: user?.name ?? '' };
	}
});

// Codes are minted in actions, where crypto randomness isn't seeded
function generateCode() {
	const bytes = crypto.getRandomValues(new Uint8Array(16));
	return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Create a user and print their access code; it is never shown again.
// Run: npx convex run users:invite '{"name": "sam"}'
export const invite = internalAction({
	args: { name: v.string() },
	handler: async (ctx, args): Promise<{ userId: Id<'users'>; code: string }> => {
		const code = generateCode();
		const userId: Id<'users'> = await ctx.runMutation(internal.users.insert, {
			name: args.name,
			codeHash: await hashCode(code)
		});
		return { userId, code };
	}
});

// Replace a user's code (lost or leaked); the old one stops working at once.
// Run: npx convex run users:resetCode '{"userId": "..."}'
export const resetCode = internalAction({
	args: { userId: v.id('users') },
	handler: async (ctx, args): Promise<{ code: string }> => {
		const code = generateCode();
		await ctx.runMutation(internal.users.setCodeHash, {
			userId: args.userId,
			codeHash: await hashCode(code)
		});
		return { code };
	}
});

export const insert = internalMutation({
	args: { name: v.string(), codeHash: v.string() },
	handler: async (ctx, args) => {
		return await ctx.db.insert('users', args);
	}
});

export const setCodeHash = internalMutation({
	args: { userId: v.id('users'), codeHash: v.string() },
	handler: async (ctx, args) => {
		await ctx.db.patch(args.userId, { codeHash: args.codeHash });
	}
});
