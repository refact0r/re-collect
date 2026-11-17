import { getContext, setContext } from 'svelte';
import type { FunctionReturnType } from 'convex/server';
import type { api } from '../convex/_generated/api';
import type { DisplayItem } from './types';

// Shape of a convex-svelte useQuery result as consumers see it
export interface QueryState<T> {
	readonly data: T | undefined;
	readonly error: Error | undefined;
	readonly isLoading: boolean;
}

type ItemsData = FunctionReturnType<typeof api.items.list>;
export type CollectionsData = FunctionReturnType<typeof api.collections.listWithCounts>;

// Typed wrappers around the app layout's contexts, so setter and consumers
// always agree on key and value type.
export const setItemsContext = (value: QueryState<ItemsData>) => setContext('items', value);
export const getItemsContext = () => getContext<QueryState<ItemsData>>('items');

export const setCollectionsContext = (value: QueryState<CollectionsData>) =>
	setContext('collections', value);
export const getCollectionsContext = () => getContext<QueryState<CollectionsData>>('collections');

// The list the item modal steps through with prev/next: the active page points
// `list` at what it shows
export type CurrentItems = { list: () => DisplayItem[] };
export const setCurrentItemsContext = (value: CurrentItems) => setContext('currentItems', value);
export const getCurrentItemsContext = () => getContext<CurrentItems>('currentItems');

// The session token, null for a logged-out visitor (read through lib/convex.ts)
export const setWriteTokenContext = (value: () => string | null) => setContext('writeToken', value);
export const getWriteTokenContext = () => getContext<() => string | null>('writeToken');
