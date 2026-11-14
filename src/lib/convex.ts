import { useConvexClient, useQuery as useConvexQuery, type UseQueryOptions } from 'convex-svelte';
import type { OptimisticUpdate } from 'convex/browser';
import type {
	FunctionArgs,
	FunctionReference,
	FunctionReturnType,
	FunctionType
} from 'convex/server';
import { ConvexError } from 'convex/values';
import { goto } from '$app/navigation';
import { page } from '$app/state';
import { api } from '../convex/_generated/api.js';
import type { Id } from '../convex/_generated/dataModel.js';
import { getWriteTokenContext } from './context';
import { loginHref } from './login.js';

// Every public function takes the caller's session token; these wrappers add it,
// so callers pass only the function's own args. Call them during component init.
// Queries open to logged-out visitors (viewerQuery) take it optionally.
type PublicFunction<T extends FunctionType> = FunctionReference<T, 'public', { token?: string }>;
type UserFunction<T extends FunctionType> = FunctionReference<T, 'public', { token: string }>;
type UserArgs<F extends PublicFunction<FunctionType>> = Omit<FunctionArgs<F>, 'token'>;

const withToken = <F extends PublicFunction<FunctionType>>(
	args: UserArgs<F>,
	token: string | null
) => (token ? { ...args, token } : args) as FunctionArgs<F>;

// Mutations and actions are the owner's: logged-out visitors only reach read-only
// views, which never call them
function requireToken(getToken: () => string | null) {
	const token = getToken();
	if (!token) throw new Error('Not signed in');
	return token;
}

export const isUnauthorized = (error: unknown) =>
	error instanceof ConvexError && error.data === 'Unauthorized';

// onError replaces telling the user (the failure is still logged)
interface CallOptions {
	onError?: (message: string) => void;
}

// An ended session goes to /login (which clears the dead cookie), set to come
// back here. Anything else is logged and reported: a ConvexError's string data
// is written for the user.
export function reportError(error: unknown, { onError = (m) => alert(m) }: CallOptions = {}) {
	if (isUnauthorized(error)) {
		goto(loginHref(page.url));
		return;
	}
	console.error(error);
	onError(
		error instanceof ConvexError && typeof error.data === 'string'
			? error.data
			: 'Something went wrong'
	);
}

// Resolves to the result (null for functions that return nothing), or to
// undefined once a failure has been handled, so it never rejects
async function run<T>(call: () => Promise<T>, options?: CallOptions): Promise<T | undefined> {
	try {
		return await call();
	} catch (error) {
		reportError(error, options);
		return undefined;
	}
}

// A logged-out visitor's queries go without a token
export function useQuery<Q extends PublicFunction<'query'>>(
	query: Q,
	args: () => UserArgs<Q> | 'skip',
	options?: UseQueryOptions<Q> | (() => UseQueryOptions<Q>)
) {
	const getToken = getWriteTokenContext();
	return useConvexQuery(
		query,
		() => {
			const userArgs = args();
			return userArgs === 'skip' ? userArgs : withToken<Q>(userArgs, getToken());
		},
		options
	);
}

// A one-time read of the owner's data, e.g. a check before a write
export function useQueryOnce() {
	const client = useConvexClient();
	const getToken = getWriteTokenContext();
	return <Q extends UserFunction<'query'>>(
		query: Q,
		args: UserArgs<Q>,
		options?: CallOptions
	): Promise<FunctionReturnType<Q> | undefined> =>
		run(() => client.query(query, withToken<Q>(args, requireToken(getToken))), options);
}

export function useMutation() {
	const client = useConvexClient();
	const getToken = getWriteTokenContext();
	// An optimistic update gets the args with the token, which the queries it
	// touches need to match their subscriptions
	return <M extends UserFunction<'mutation'>>(
		mutation: M,
		args: UserArgs<M>,
		options?: CallOptions & { optimisticUpdate?: OptimisticUpdate<FunctionArgs<M>> }
	): Promise<FunctionReturnType<M> | undefined> =>
		run(
			() =>
				client.mutation(mutation, withToken<M>(args, requireToken(getToken)), {
					optimisticUpdate: options?.optimisticUpdate
				}),
			options
		);
}

export function useAction() {
	const client = useConvexClient();
	const getToken = getWriteTokenContext();
	return <A extends UserFunction<'action'>>(
		action: A,
		args: UserArgs<A>,
		options?: CallOptions
	): Promise<FunctionReturnType<A> | undefined> =>
		run(() => client.action(action, withToken<A>(args, requireToken(getToken))), options);
}

// Permanently deletes an item (and its stored image) once the user confirms.
// onConfirmed runs before the request, e.g. to close the modal showing it.
export function useDeleteItem() {
	const mutate = useMutation();
	return (id: Id<'items'>, onConfirmed?: () => void) => {
		if (!confirm('Delete this item? This cannot be undone.')) return;
		onConfirmed?.();
		mutate(api.items.remove, { id });
	};
}
