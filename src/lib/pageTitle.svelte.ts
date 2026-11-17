// A page's own name for the tab title, rendered by the root layout's <title>.
// The root owns the one <title> because Svelte sets document.title without
// restoring it when a page unmounts, so a page's own <title> would outlive it.
// Effects don't run during SSR, so a page that needs its title there returns
// `title` from its load as well.
export const pageTitle = $state<{ value: string | null }>({ value: null });

// Names the tab while the calling page is mounted; call during component init
export function usePageTitle(title: () => string | null | undefined) {
	$effect(() => {
		pageTitle.value = title() ?? null;
		return () => (pageTitle.value = null);
	});
}
