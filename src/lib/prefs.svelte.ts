import type { FunctionArgs } from 'convex/server';
import { api } from '../convex/_generated/api.js';
import type { Doc, Id } from '../convex/_generated/dataModel.js';
import { useMutation, useQuery } from './convex.js';
import { getCollectionsContext } from './context.js';
import type { CollectionSortOption } from './types.js';

type PrefsKey = FunctionArgs<typeof api.viewPreferences.set>['key'];
type HomeFields = Omit<FunctionArgs<typeof api.viewPreferences.set>, 'key' | 'token'>;
type ViewFields = Pick<
	FunctionArgs<typeof api.collections.update>,
	'sortMode' | 'viewMode' | 'columnOffset' | 'showTitles'
>;

// The view settings controls and item lists work with, wherever a page stores them
export interface ViewPrefs {
	readonly sortBy: CollectionSortOption;
	readonly viewMode: 'grid' | 'list';
	readonly columnOffset: number;
	readonly showTitles: boolean;
	readonly set: (fields: ViewFields) => void;
}

// Reads come straight from the saved doc (undefined until it loads or, for a
// collection, while it isn't found) and writes patch the query result holding it
// optimistically, so a change shows at once, rolls back if the write fails, and
// changes made in other tabs come through.
function viewPrefs<Saved extends ViewFields, Fields>(
	saved: () => Saved | null | undefined,
	defaultSort: NonNullable<Saved['sortMode']>,
	set: (fields: Fields) => void
) {
	const doc = $derived.by(saved);
	// One derived per setting, so a query keyed on one doesn't restart when another changes
	const loaded = $derived(doc !== undefined);
	const sortBy = $derived<typeof defaultSort>(doc?.sortMode ?? defaultSort);
	const viewMode = $derived(doc?.viewMode ?? 'grid');
	const columnOffset = $derived(doc?.columnOffset ?? 0);
	const showTitles = $derived(doc?.showTitles ?? false);
	return {
		get saved() {
			return doc;
		},
		get loaded() {
			return loaded;
		},
		get sortBy() {
			return sortBy;
		},
		get viewMode() {
			return viewMode;
		},
		get columnOffset() {
			return columnOffset;
		},
		get showTitles() {
			return showTitles;
		},
		set
	};
}

// Home, search and discover keep theirs in a viewPreferences row
export function useViewPrefs(key: PrefsKey) {
	const mutate = useMutation();
	const saved = useQuery(api.viewPreferences.get, () => ({ key }));
	return viewPrefs(
		() => saved.data,
		'dateAddedNewest',
		(fields: ViewFields & Omit<HomeFields, 'sortMode'>) =>
			mutate(
				api.viewPreferences.set,
				// 'manual' sort is only offered on collection pages
				{ key, ...(fields as HomeFields) },
				{
					optimisticUpdate: (store, { token, ...update }) => {
						// Same args (and key order) as the subscription above
						const args = { key, token };
						const current = store.getQuery(api.viewPreferences.get, args);
						if (current === undefined) return;
						store.setQuery(api.viewPreferences.get, args, {
							...current,
							...update
						} as Doc<'viewPreferences'>);
					}
				}
			)
	);
}

// Someone else's shared collection: starts from the owner's saved settings, and
// changes stay on this page (kept per collection, so the next one starts afresh)
export function useLocalPrefs(id: () => string, saved: () => ViewFields | null | undefined) {
	let local = $state<{ id: string; fields: ViewFields }>({ id: '', fields: {} });
	const fields = $derived(local.id === id() ? local.fields : {});
	return viewPrefs(
		() => {
			const doc = saved();
			return doc && { ...doc, ...fields };
		},
		'manual',
		(update: ViewFields) => {
			local = { id: id(), fields: { ...fields, ...update } };
		}
	);
}

// A collection keeps its own on the collection doc, read from the layout's collections query
export function useCollectionPrefs(id: () => Id<'collections'>) {
	const mutate = useMutation();
	const collections = getCollectionsContext();
	return viewPrefs(
		() => collections.data?.find((c) => c._id === id()),
		'manual',
		(fields: ViewFields) =>
			mutate(
				api.collections.update,
				{ id: id(), ...fields },
				{
					optimisticUpdate: (store, { token, id: collectionId, ...update }) => {
						// The layout subscribes with just the token
						const current = store.getQuery(api.collections.listWithCounts, { token });
						if (!current) return;
						store.setQuery(
							api.collections.listWithCounts,
							{ token },
							current.map((c) => (c._id === collectionId ? { ...c, ...update } : c))
						);
					}
				}
			)
	);
}
