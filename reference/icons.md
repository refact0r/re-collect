# Icons

This project uses [unplugin-icons](https://github.com/unplugin/unplugin-icons) with Material Symbols Sharp icons.

## Usage

Import from `~icons/material-symbols/` with the `-sharp` suffix:

```svelte
<script lang="ts">
  import IconClose from '~icons/material-symbols/close-sharp';
  import IconMenu from '~icons/material-symbols/menu-sharp';
</script>

<button>
  <IconClose />
</button>
```

## Styling

Icons are SVG components. Use `:global(svg)` to style them:

```svelte
<style>
  button :global(svg) {
    width: 1.5rem;
    height: 1.5rem;
  }
</style>
```

## Finding Icons

Browse icons at: <https://icon-sets.iconify.design/material-symbols/>

Add `-sharp` suffix when importing (e.g., `close` → `close-sharp`).
