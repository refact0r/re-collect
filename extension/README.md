# re-collect browser extension

Save pages, links and images to re-collect from the browser. Plain JS Manifest V3, no build step.

- **Toolbar popup**: saves the current tab, with an optional collection and a screenshot mode.
- **Context menu**: a "Save to …" submenu with Page (in each screenshot mode), Link and Image. It saves to the collection last picked in the popup (or uncollected), and its title shows the target.
- A badge on the toolbar icon and a toast in the page confirm success or failure.

Page saves have three screenshot modes:

- **Auto** (the default): the backend's screenshot worker captures the page, as for any URL item.
- **Visible area**: the extension captures what's on screen.
- **Selected area**: drag out a region on the page (Esc cancels) and the extension captures just that.

Captures are taken at the screen's pixel density and saved as WebP. `imageImport.addPageWithImage` stores the image in R2 and creates a URL item that uses it in place of the worker's screenshot, so it's tagged right away. The page's og:description is read from the page.

Auto page saves and link saves call `items.add`, and the backend screenshots and tags them as usual. Image saves call `imageImport.addFromUrl`, which fetches the image server-side, stores it in R2 and creates an image item with the page as its source URL. If the image can't be fetched (hotlink protection, a `blob:` URL), it saves the page as a URL item instead.

## Install (Chrome)

1. Go to `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select this `extension/` folder.
3. Open the extension's **Options** page and fill in:
   - **Convex deployment URL**: the `.convex.cloud` URL (`PUBLIC_CONVEX_URL`), not the `.convex.site` one.
   - **Write token**: the deployment's `CONVEX_WRITE_TOKEN`.

   Saving checks the URL by loading collections. The token is only checked on the first save.

After editing the source, click the reload icon on the extension's card.

## Firefox

The manifest also declares `background.scripts` and a gecko ID, so Firefox (121+) can load it through `about:debugging` → **This Firefox** → **Load Temporary Add-on…** → `manifest.json`. This path is untested.

## Files

- `api.js`: settings in `chrome.storage.local`, plus a tiny client for Convex's HTTP API (`POST /api/{query,mutation,action}`).
- `background.js`: context menus, badge and toast.
- `popup.*` and `options.*`: the two extension pages. `style.css` is shared between them.
