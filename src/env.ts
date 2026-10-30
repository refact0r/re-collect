import { defineEnvVars } from '@sveltejs/kit/env';

// Secrets are optional so a missing one degrades to read-only (auth fails closed)
// instead of stopping the app from starting
const optional = (input: string | undefined) => input;

export const variables = defineEnvVars({
	AUTH_PASSWORD: { schema: optional },
	CONVEX_WRITE_TOKEN: { schema: optional },
	PUBLIC_CONVEX_URL: { public: true, static: true }
});
