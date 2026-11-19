import { ConvexError, v } from 'convex/values';
import { mutation } from './_generated/server';
import { rateLimiter } from './lib/rateLimits';

// Past this many rows the list stops taking new emails
export const WAITLIST_CEILING = 2000;

const MAX_EMAIL_LENGTH = 254;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Join the waitlist from the landing page; anyone can call it, signed in or not.
// It answers the same whether or not the email was already on the list, so
// the form never reveals who signed up. `website` is a honeypot field people
// never see: a bot that fills it gets the same answer and nothing is stored.
export const join = mutation({
	args: { email: v.string(), website: v.optional(v.string()) },
	handler: async (ctx, args) => {
		if (args.website) return null;

		const email = args.email.trim().toLowerCase();
		if (email.length > MAX_EMAIL_LENGTH || !EMAIL_SHAPE.test(email)) {
			throw new ConvexError('that doesn’t look like an email');
		}

		const { ok } = await rateLimiter.limit(ctx, 'join');
		if (!ok) throw new ConvexError('lots of signups right now, try again in a minute');

		// Checked before the duplicate check, so a full list answers everyone alike
		const counter = await ctx.db.query('waitlistCount').first();
		const count = counter?.count ?? 0;
		if (count >= WAITLIST_CEILING) throw new ConvexError('the waitlist is full for now');

		const existing = await ctx.db
			.query('waitlist')
			.withIndex('by_email', (q) => q.eq('email', email))
			.first();
		if (existing) return null;

		await ctx.db.insert('waitlist', { email });
		if (counter) await ctx.db.patch(counter._id, { count: count + 1 });
		else await ctx.db.insert('waitlistCount', { count: 1 });
		return null;
	}
});
