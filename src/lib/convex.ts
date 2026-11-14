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
import { api } from '../convex/_generated/api.js';
import type { Id } from '../convex/_generated/dataModel.js';
import { getWriteTokenContext } from './context';

// Every public function takes the caller's session token; these wrappers add it,
// so callers pass only the function's own args. Call them during component init.
type UserFunction<T extends FunctionType> = FunctionReference<T, 'public', { token: string }>;
type UserArgs<F extends UserFunction<FunctionType>> = Omit<FunctionArgs<F>, 'token'>;

const withToken = <F extends UserFunction<FunctionType>>(args: UserArgs<F>, token: string) =>
	({ ...args, token }) as FunctionArgs<F>;

export const isUnauthorized = (error: unknown) =>
	error instanceof ConvexError && error.data === 'Unauthorized';

// onError replaces telling the user (the failure is still logged)
interface CallOptions {
	onError?: (message: string) => void;
}

// An ended session goes to /login (which clears the dead cookie). Anything else
// is logged and reported: a ConvexError's string data is written for the user.
export function reportError(error: unknown, { onError = (m) => alert(m) }: CallOptions = {}) {
	if (isUnauthorized(error)) {
		goto('/login');
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

export function useQuery<Q extends UserFunction<'query'>>(
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
				client.mutation(mutation, withToken<M>(args, getToken()), {
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
		run(() => client.action(action, withToken<A>(args, getToken())), options);
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
