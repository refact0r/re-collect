// A page's own name for the tab title, rendered by the root layout's <title>.
// The root owns the one <title> because Svelte sets document.title without
// restoring it when a page unmounts, so a page's own <title> would outlive it.
// Pages set this in an effect and clear it in its cleanup; during SSR a page
// can return `title` from its load instead.
export const pageTitle = $state<{ value: string | null }>({ value: null });
