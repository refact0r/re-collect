# Design tokens for URL items: research and proposal

Status: Phase 1 (research). Nothing here is implemented yet. Prototype: `experiments/design-tokens/`.

The idea: the screenshot worker already loads every saved page in headless Chromium, so it can also read the site's design tokens (fonts, type scale, colors and so on). That makes queries like "every site I saved that uses GT America" searchable, puts the tokens on the item modal, and lets you copy them out.

## TL;DR

- **Fonts are the clear win.** Family names come out cleanly on 34 of 40 test sites, which render their primary text in a web font; the other 6 use system fonts and report those names. Chromium's internal font name (from the font file, read over CDP) is often the nicer label: `areal` → "ABC Areal Superfamily Variable", `fhd` → "FH Dfaalt", `SOEHNE` → "Söhne", `cinetype` → "GT Cinetype". That gives two search tokens per font.
- **The type scale is good.** Display, h1, h2, body and small sizes come with weight, line-height and letter-spacing in em. Use "largest text" rather than `h1`: only 20 of 40 sites had an `h1` in the first three screens.
- **Colors are fine with caveats.** Area-weighted background, text color and light/dark come out right. Accent colors are noisy but usable once default link blue is filtered out. They overlap with the existing pixel palette, but these are exact CSS hex values with roles.
- **Tech fingerprinting is cheap and reliable** for builders and frameworks (Framer, Webflow, WordPress, Next, Astro, Tailwind) and for motion libraries (GSAP, Lenis, Three.js).
- **Cost is negligible:** about 70 ms median (p90 about 400 ms) on top of a page load that already takes 4–20 s. The real cost question is pages the worker doesn't open in a browser today (og fast path, extension screenshots) and backfill, since each backfilled item needs a fresh browser visit.
- Spacing scale, radii, shadows, motion curves, CSS custom-property dumps and dark-mode detection either work only some of the time or need a second page load. They go on the later list.

## Prototype

`experiments/design-tokens/run.mjs` loads each URL the way `workers/screenshot` does: 1440×900 viewport, the same UA and tracker blocking, domcontentloaded, then network idle (up to 10 s), then a settle delay. It then runs `extract.js` in the page and records Chromium's ground truth via `CSS.getPlatformFontsForNode`. It used local headless Chrome (`puppeteer-core`).

Sites: all 33 URL items in the dev deployment (read with `convex data items`; no external APIs), plus linear.app, vercel.com, klim.co.nz, are.na, theguardian.com, MDN, zeit.de and spiegel.de as dark-mode and cookie-wall probes. That's 40 sites. Raw output is in `out/results.json`, and a readable dump is in `out/summary.txt`.

### Token-by-token findings

| Token                                             | How                                                                                                                                                                                       | Reliability                         | Noise                                                                                                                                                                                                                               | Value to a designer                                                                                                                          | Verdict                                                     |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Font families + role (heading / body / UI / mono) | `getComputedStyle().fontFamily` on every element that directly owns text in the first 3 screens, weighted by character count; first declared family, minus `… Fallback` / `… Placeholder` | High                                | Low. KaTeX and other minor faces show up at <3% share, so drop them below a threshold                                                                                                                                               | Very high (search, "what is this typeface")                                                                                                  | **v1**                                                      |
| Internal font name                                | CDP `CSS.getPlatformFontsForNode` on one marked element per family                                                                                                                        | 77 of 83 web fonts gave a sane name | 6 junk: `Copyright Klim Type Foundry` (Söhne on stripe.dev), empty names for MyFonts/Monotype kits. Names include weights ("Denim SemiBold"), so strip those. When an element mixes fonts, pick the entry that matches the CSS name | High: better canonical names, and they often carry the foundry prefix (ABC, GT, PP, FH)                                                      | **v1** (best effort; fall back to the CSS name)             |
| Loaded vs declared                                | `document.fonts` (status `loaded`)                                                                                                                                                        | High                                | Sites that declare a font they never serve (`"Graphik LC"` on pipeline.one, `Segoe UI` on meganyap.me) render a fallback. Keep the declared name, flagged as system/unloaded                                                        | Medium                                                                                                                                       | **v1** (flag only)                                          |
| Font source                                       | Resource-timing font URLs, `<link>` to fonts.googleapis.com (family list) and use.typekit.net (kit id)                                                                                    | High                                | Framer and Next hash file names (`4w6Hg5….woff2`), but self-hosted sites often keep readable names (`GT-America-Mono-Light`, `205TF_Muoto_Variable`)                                                                                | Medium ("Google Fonts" vs "licensed")                                                                                                        | v1: provider only. Later: file names as extra search tokens |
| Foundry                                           | No machine-readable source                                                                                                                                                                | n/a                                 | n/a                                                                                                                                                                                                                                 | High for the dream query, but needs a hand-made prefix table (GT → Grilli Type, ABC → Dinamo, PP → Pangram Pangram, Söhne/Tiempos → Klim, …) | Later                                                       |
| Type scale                                        | Computed size, weight, line-height and letter-spacing of: largest text ("display"), first h1/h2/h3, the body size (most prose characters), and the most common smaller size               | High                                | Fluid type gives odd decimals (13.7388px), so round to 0.5px. `h1` is often missing or tiny (are.na, edoardolunardi.dev)                                                                                                            | High (e.g. "64px / 1.0 / −0.06em, w400")                                                                                                     | **v1**: display, h1, h2, body, small                        |
| Background color                                  | 36×24 grid of `elementFromPoint` over the viewport; topmost opaque `background-color`; `img`/`video`/`canvas`/bg-image counted as media coverage                                          | High on normal pages                | Wrong during preloaders, and empty under full-screen consent iframes (Spiegel: 100% "media")                                                                                                                                        | Medium. Overlaps `paletteHex`, but exact and labeled                                                                                         | **v1**: top 1–3 with share, plus light/dark                 |
| Text color                                        | Computed `color` weighted by characters                                                                                                                                                   | High                                | Low                                                                                                                                                                                                                                 | Medium                                                                                                                                       | **v1**: top 1–2                                             |
| Accent color                                      | Chromatic fills on links and buttons, chromatic link/text/border colors, chromatic background areas                                                                                       | Medium                              | `#0000ee` (unstyled links) everywhere until filtered; syntax-highlight colors on code-heavy pages (stripe.dev)                                                                                                                      | Medium                                                                                                                                       | **v1**: top 2, chroma > 0.25                                |
| `:root` custom properties                         | Walk accessible stylesheets for `--*` on `:root`/`html`/`[data-theme]`, resolve with `getComputedStyle`                                                                                   | 33 of 40 sites define color vars    | Huge range (0 to 1274 on YouTube). Names range from semantic (`--background-primary`) to minified (`--td176b92ada598f8f`) to framework palettes (`--wp--preset--*`, Tailwind's whole `--color-red-50…`)                             | High for export, low for browsing                                                                                                            | Later (export)                                              |
| Dark mode                                         | (a) count `@media (prefers-color-scheme: dark)` rules; (b) re-probe after `emulateMediaFeatures`                                                                                          | Low                                 | (a) misses class-based themes (`next-themes`), which switch at load via JS; (b) the live toggle rarely changes anything for the same reason. vercel.com and are.na only flip on a fresh load in dark                                | Medium                                                                                                                                       | Later: needs a second load (+4–10 s of browser time)        |
| Radius character                                  | Top-left radius of visible boxed elements (fill, border or shadow): share sharp / rounded / pill, plus top px values                                                                      | Medium-high                         | Low for "sharp vs rounded vs pill". Exact px values scatter                                                                                                                                                                         | Medium ("all square corners")                                                                                                                | Later (could be a cheap v1.1 tag)                           |
| Shadows                                           | Distinct `box-shadow` values                                                                                                                                                              | Medium                              | Tailwind's transparent ring defaults on everything (filtered)                                                                                                                                                                       | Low                                                                                                                                          | Later                                                       |
| Spacing scale                                     | padding/gap/margin histogram, divisibility by 4 and 8                                                                                                                                     | Low                                 | Only half the sites are clearly on a 4/8 grid; margins are noisy                                                                                                                                                                    | Low                                                                                                                                          | Later / no                                                  |
| Max content width                                 | Centered elements ≥480px wide, weighted by height                                                                                                                                         | Medium (25 of 40 found one)         | Full-bleed sites have none                                                                                                                                                                                                          | Low-medium                                                                                                                                   | Later                                                       |
| Motion                                            | `transition-duration` / timing functions on elements at rest, keyframe counts, `document.getAnimations()`                                                                                 | Medium                              | Only shows CSS transitions as declared, not JS motion                                                                                                                                                                               | Low; the curves are fun for nerds (`cubic-bezier(0.16,1,0.3,1)`)                                                                             | Later; motion _libraries_ go into tech                      |
| Tech fingerprint                                  | Globals and markers: `__NEXT_DATA__`, `data-framer-*`, `data-wf-site`, `astro-island`, `wp-content`, generator meta, Tailwind vars, `window.gsap`/`Lenis`/`__THREE__`, …                  | High for builders and frameworks    | Plain React detection is a guess; "Three.js" also fires on sites that just bundle it                                                                                                                                                | Medium-high ("show me Framer sites")                                                                                                         | **v1** (search tokens)                                      |

### Cost

Measured locally on 40 sites, 5 in parallel:

- Page load (already paid by the screenshot path): p50 6.2 s, p90 12.5 s.
- In-page extraction: 16–130 ms. Two pages took about 3 s because `document.fonts.ready` hung, so cap it at 2 s.
- CDP internal-name lookups (up to 6 per page): p50 about 20 ms, max about 580 ms.
- Stored v1 subset: median about 0.8 KB of JSON, max about 1.5 KB.

So extraction adds under 1 s to each screenshot capture (well under 10% of its browser time). Browser Run limits (Cloudflare docs, checked 2026-11-12):

- **Workers Free:** 10 min/day, 3 concurrent, 1 new browser per 20 s, 60 s idle timeout.
- **Workers Paid:** 10 h/month included, then $0.09/h; 10 concurrent included (averaged), then $2 per extra.

On the free plan, one capture is about 10–20 s of browser time, so about 30–60 captures a day _in total_. Extraction barely changes that. Backfill and any "open a browser only for tokens" path do.

`@cloudflare/puppeteer` 1.4.0 exposes `createCDPSession()` in its types. I haven't verified that `CSS.getPlatformFontsForNode` works against Browser Run. If it doesn't, we lose the internal names and keep the CSS names.

### Failure modes seen

- **Preloaders and intro screens.** nlc.obys.agency showed only a "05" counter and foundry.basement.studio a splash. Typography mostly survives: the extractor reads computed styles of text that is laid out but hidden (`opacity: 0`), so reveal animations don't hide it. Colors get sampled from the loader. A run after the existing 5 s settle got Basement's six display faces right.
- **Cookie walls.** Spiegel's Sourcepoint iframe covers the viewport, so background sampling is empty. Typography is unaffected because the DOM underneath is intact. Detect CMP containers (`sp_message`, `onetrust`, `didomi`, …) and full-viewport iframes, then sample with `elementsFromPoint` past them.
- **Bot blocks.** zeit.de served "Ihre Anfrage wurde blockiert" (your request was blocked), and the tokens then describe the block page. The screenshot has the same problem today. Detect challenge or block titles and skip tokens.
- **Canvas and WebGL.** Text drawn in canvas is invisible to the extractor. Record canvas coverage so the UI can say "mostly WebGL".
- **Obfuscated names.** Font-shop kits (`3B2802_0_0.woff2`, empty internal name), Framer and Next hashed file names, junk internal names (Klim). The CSS family is still the best fallback; never index file hashes.
- **Icon fonts.** Font Awesome and eicons loaded on nordquantique.ca but were correctly excluded (Private Use Area glyph check plus a name regex).
- **OS appearance leak.** Local headless Chrome inherited macOS dark mode, so vercel.com and are.na came out dark. The worker should pin `prefers-color-scheme: light` so screenshots and tokens are deterministic.
- **Cross-origin stylesheets.** Rarely blocked in this sample (4 sheets across 40 sites). This affects only custom properties and `@font-face` scans, never computed styles.
- **Linux vs Mac system fonts.** On Browser Run, `-apple-system` and `Helvetica` resolve to Linux fallbacks. Since we report the _declared_ family, that's fine.

## Recommendation

### v1 token set

1. **Fonts:** up to 4 families with share ≥ 3% (or used for headings). Each one has its CSS name, internal name (cleaned of weights and junk), roles, weights used, `webfont` flag, and provider (Google / Adobe / self-hosted / system).
2. **Type scale:** display, h1, h2, body and small. Each has its family, px size (to 0.5), weight, unitless line-height and letter-spacing in em, and text-transform.
3. **Colors:** background (top 3 with area share), text (top 2), accent (top 2), and `scheme: 'light' | 'dark'`.
4. **Tech:** builder/framework and motion-library names.

### Later

- Foundry lookup table, and font file names as extra search tokens.
- Radius character (sharp / rounded / pill) as a tag.
- Dark-mode support (second load with `prefers-color-scheme: dark`, maybe a dark screenshot too).
- `:root` color variables for export.
- Container width, shadows, motion curves.
- A "fonts in my library" index page.
- Typeface classification (serif / sans / mono / display) via Google Fonts metadata.
- Extracting in the browser extension (see below).

### Surfacing

- **Item modal:** a "Site" block under the palette. It shows font chips (rendered in a neutral face, with internal name, role and provider), a compact type-scale table (display / h1 / h2 / body / small: `64 / 1.0 / −0.06em · 400`), and CSS color swatches labeled bg / text / accent. Clicking a font chip opens search for that font.
- **Search:** add font names (CSS and internal, plus an ASCII-folded form, so "Söhne" also matches `sohne`), the provider ("google fonts" / "adobe fonts"), and tech names to `searchText`. "gt america", "söhne", "framer" and "webflow" all work then.
- **Export:** a "Copy as CSS" button in the modal that writes `:root { --font-heading: …; --font-body: …; --text-display: 64px/1 …; --color-bg: …; --color-text: …; --color-accent: … }`. It's generated client-side from stored tokens, so it's cheap to add in v1.
- **Filters:** a font facet across the library is a follow-up. Search covers the main use case.

### Schema

`items.list` returns full item documents for the whole grid, so the full token blob should not live on `items`. Proposal:

```ts
// items: only what searchText and grid-level features need
fontNames: v.optional(v.array(v.string())), // deduped display names, CSS + internal
siteTech: v.optional(v.array(v.string())),

// one row per URL item that has tokens, loaded only by the modal
designTokens: defineTable({
  itemId: v.id('items'),
  version: v.number(), // extractor version, for re-extraction
  fonts: v.array(v.object({
    family: v.string(), internalName: v.optional(v.string()),
    roles: v.array(v.string()), weights: v.array(v.number()),
    webfont: v.boolean(), provider: v.optional(v.string()), share: v.number()
  })),
  type: v.object({ display: v.optional(textStyle), h1: …, h2: …, body: …, small: … }),
  colors: v.object({ background: v.array(swatch), text: v.array(swatch), accent: v.array(swatch),
                     scheme: v.union(v.literal('light'), v.literal('dark')) })
}).index('by_item', ['itemId'])
```

Like `itemCollectionPositions`, `designTokens` is reached only through an owned item: a `userQuery` that does `getOwned(item)` and then reads the row by index. Deleting an item deletes the row. `buildSearchText` gains `fontNames` and `siteTech`, and every caller passes them through.

### Pipeline

- **Worker:** after the screenshot is taken and before `browser.close()`, run the extractor with a hard timeout. On any error, return no tokens and never fail the capture. Add `designTokens` to the JSON response. Pin `prefers-color-scheme: light` before navigation. The extractor is a plain function passed to `page.evaluate`; give the worker tsconfig the DOM lib instead of the hand-declared globals.
- **og mode:** the fast path (plain fetch, no browser) yields no tokens. When og mode falls back to the browser, extract after `document.fonts.ready` (capped). Choices: accept that og-mode items mostly have no tokens, or make og mode always open a browser (more browser time). I recommend accepting it for v1.
- **Convex:** `generateScreenshotInternal` passes `designTokens` through to `setCompleted`. That validates the payload and caps array lengths, upserts the `designTokens` row, and sets `fontNames`/`siteTech` plus `searchText`. `reimageItem` refreshes tokens for free.
- **Extension saves** supply their own screenshot and skip the worker, so they get no tokens. The extension already has `scripting` permission, and running the same extractor in the user's real tab is arguably the _best_ source: logged in, cookie wall dismissed, intro played. It can't do the CDP name lookup, and the extension has no build step, so the extractor would need to be copied in. Later. This keeps v1 off `items.add`, so it doesn't collide with the `refact0r/browser-extension-475d02` branch.

### Backfill

Existing URL items have no stored DOM, so backfilling means a fresh browser visit: a `tokens` worker mode that loads and extracts without taking a screenshot or touching R2. It would run through the same `screenshotPool` (parallelism 1, 429 retry) and land in a `setDesignTokens` mutation. Each item costs roughly 5–15 s of browser time, so the free plan does about 40–80 a day. Tokens would describe the site _today_, which may not match an old screenshot.

Recommendation: ship v1 for new saves. Then run the backfill once as an opt-in migration if the library size and plan allow, or offer a per-item "extract tokens" action. The existing "refresh image" action already re-runs everything.
