# Icons

This project uses [unplugin-icons](https://github.com/unplugin/unplugin-icons) with Material Symbols Light icons.
Browse icons at: <https://icon-sets.iconify.design/material-symbols-light/>

## Usage

Import from `~icons/material-symbols-light/`:

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
  }
</style>
```

In global CSS files (like `app.css`), target SVGs directly without `:global()`:

```css
button.icon svg {
}
```
