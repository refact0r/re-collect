import { onMount } from 'svelte';
import { api } from '../convex/_generated/api.js';
import { useAction, useQuery } from './convex.js';

// The caller's library map (see convex/embeddingMap.ts), brought up to date on
// mount; the refresh is a no-op when nothing changed since the stored layout.
// Call during component init.
export function useLibraryMap() {
	const map = useQuery(api.embeddingMap.get, () => ({}));
	const refresh = useAction();
	let updating = $state(true);
	let failed = $state(false);

	onMount(() => {
		refresh(api.embeddingMapActions.refresh, {}, { onError: () => (failed = true) }).finally(
			() => (updating = false)
		);
	});

	return {
		get points() {
			return map.data?.points ?? [];
		},
		// Nothing to show yet, and a layout may still be on its way
		get pending() {
			return map.isLoading || updating;
		},
		get updating() {
			return updating;
		},
		get failed() {
			return failed;
		}
	};
}
