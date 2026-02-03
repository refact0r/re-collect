# Icons

This project uses [unplugin-icons](https://github.com/unplugin/unplugin-icons) with Material Symbols Light icons.

## Usage

Import from `~icons/material-symbols-light/` (some with the `-sharp` suffix, depending on the icon):

```svelte
<script lang="ts">
  import IconClose from '~icons/material-symbols-light/close';
  import IconMenu from '~icons/material-symbols-light/menu';
</script>

<button>
  <IconClose />
</button>
```

## Styling

Icons are SVG components. In Svelte component styles, use `:global(svg)` to style them:

```svelte
<style>
  button :global(svg) {
    width: 1.5rem;
    height: 1.5rem;
  }
</style>
```

In global CSS files (like `app.css`), target SVGs directly without `:global()`:

```css
button.icon svg {
  width: 1.5rem;
  height: 1.5rem;
}
```

## Finding Icons

Browse icons at: <https://icon-sets.iconify.design/material-symbols-light/>

Add `-sharp` suffix when importing (e.g., `close` → `close-sharp`).
