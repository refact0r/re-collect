import { getContext, setContext } from 'svelte';
import type { FunctionReturnType } from 'convex/server';
import type { api } from '../convex/_generated/api';
import type { CurrentItemsContext } from './types';

// Shape of a convex-svelte useQuery result as consumers see it
export interface QueryState<T> {
	readonly data: T | undefined;
	readonly error: Error | undefined;
	readonly isLoading: boolean;
}

export type ItemsData = FunctionReturnType<typeof api.items.list>;
export type CollectionsData = FunctionReturnType<typeof api.collections.listWithCounts>;

// Typed wrappers around the app layout's contexts, so setter and consumers
// always agree on key and value type.
export const setItemsContext = (value: QueryState<ItemsData>) => setContext('items', value);
export const getItemsContext = () => getContext<QueryState<ItemsData>>('items');

export const setCollectionsContext = (value: QueryState<CollectionsData>) =>
	setContext('collections', value);
export const getCollectionsContext = () => getContext<QueryState<CollectionsData>>('collections');

export const setCurrentItemsContext = (value: CurrentItemsContext) =>
	setContext('currentItems', value);
export const getCurrentItemsContext = () => getContext<CurrentItemsContext>('currentItems');

// The session token, null for a logged-out visitor
export const setWriteTokenContext = (value: () => string | null) => setContext('writeToken', value);
// For code that only runs signed in (private pages, owner controls); logged-out
// visitors only reach read-only views, which never ask for it
export const getWriteTokenContext = () => {
	const get = getContext<() => string | null>('writeToken');
	return () => {
		const token = get();
		if (!token) throw new Error('Not signed in');
		return token;
	};
};
