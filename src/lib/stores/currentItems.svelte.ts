// Svelte 5 reactive state for current items being displayed
// Used by ItemModal for arrow key navigation

let items = $state<any[]>([]);

export function setCurrentItems(newItems: any[]) {
	items = newItems;
}

export function getCurrentItems() {
	return items;
}
