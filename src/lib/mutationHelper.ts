/**
 * Helper to execute mutations with token and handle auth errors.
 * Shows an alert if the user is not authenticated.
 */
export async function mutate<T>(
	token: string | null,
	fn: (token: string | undefined) => Promise<T>
): Promise<T | null> {
	if (token === null) return null;
	try {
		return await fn(token);
	} catch (e) {
		if (e instanceof Error && e.message.includes('Unauthorized')) {
			// alert('Please log in to make changes');
			return null;
		}
		throw e;
	}
}
