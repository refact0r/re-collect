import { usePaginatedQuery } from 'convex-svelte';
import type {
	FunctionReference,
	FunctionReturnType,
	PaginationOptions,
	PaginationResult
} from 'convex/server';
import type { QueryState } from './context';

type PaginatedQuery = FunctionReference<
	'query',
	'public',
	{ paginationOpts: PaginationOptions },
	PaginationResult<unknown>
>;
// The query's args without paginationOpts, or 'skip'
type PageArgs<Q extends PaginatedQuery> = Exclude<
	Parameters<typeof usePaginatedQuery<Q>>[1],
	(() => unknown) | undefined
>;
export type PageItem<Q extends PaginatedQuery> = FunctionReturnType<Q>['page'][number];

// Every page of a paginated query, as one list that arrives whole, shaped like a
// useQuery result: data stays undefined (and isLoading true) until the last page
// is in. Each page stays its own subscription, pinned to the range it first
// covered, so a write re-runs only the page it lands in. The first page is kept
// small because new rows land there and get the most writes; the Convex client
// splits any page past twice its size, so later pages settle at about that.
export function useAllPages<Q extends PaginatedQuery>(
	query: Q,
	args: () => PageArgs<Q>,
	{ firstPage, page }: { firstPage: number; page: number }
): QueryState<PageItem<Q>[]> {
	const pages = usePaginatedQuery(query, args, { initialNumItems: firstPage });
	const skipped = $derived(args() === 'skip');

	$effect(() => {
		if (pages.status === 'CanLoadMore') pages.loadMore(page);
	});

	const complete = $derived(!pages.error && pages.status === 'Exhausted');
	return {
		get data() {
			return complete ? (pages.results as PageItem<Q>[]) : undefined;
		},
		get error() {
			return pages.error;
		},
		get isLoading() {
			return !skipped && !pages.error && !complete;
		}
	};
}
