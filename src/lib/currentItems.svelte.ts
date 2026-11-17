import { getCurrentItemsContext } from './context';
import type { DisplayItem } from './types';

// Points the item modal's prev/next at `list` (set during init so the modal,
// rendered after the page, sees it at once), until a page without one. Call
// during component init.
export function useCurrentItems(list: () => DisplayItem[]) {
	const currentItems = getCurrentItemsContext();
	currentItems.list = list;
	$effect(() => () => {
		if (currentItems.list === list) currentItems.list = () => [];
	});
}
