# Multi-user

Every item, collection and view preference belongs to a user. Users sign in
with a **personal access code**: a long random secret you mint for each person
and send them as a login link. There are no passwords, signup pages or external
auth services, and page loads cost nothing extra.

## Data model

- **`users` table**: `{ name, codeHash }`, indexed `by_codeHash`. Only the
  SHA-256 hash of each access code is stored.
- **`userId` on owned tables**: `items`, `collections`, `viewPreferences`.
  Indexes are user-first: `items.by_user_dateAdded` / `by_user_dateModified`,
  `collections.by_user_position`, `viewPreferences.by_user_key`, and the
  `search_items` search index filters on `userId`. `itemCollectionPositions`
  has no `userId`: its rows are only reached through an owned item or
  collection, and `addItemToCollection` refuses to link an item and collection
  with different owners.

## How a request is authenticated

1. `/login?code=…` (or pasting the code into the login form) checks the code
   against Convex (`users.me`) and stores it in a one-year, httpOnly
   `access-code` cookie.
2. The `(app)` layout reads the cookie and hands the code to the client as
   `writeToken`. A request without the cookie is redirected to `/login`. The
   server doesn't re-check the code on each load, so there is no extra round
   trip.
3. The client sends the code as the `token` arg on every Convex query and
   mutation. `userQuery` / `userMutation` (`src/convex/lib/auth.ts`) call
   `requireUser`, which hashes the token, looks up the user (one indexed read)
   and passes `ctx.userId` to the handler. An unknown code throws
   `Unauthorized`, and the app layout then sends the user back to `/login`.
4. `getOwned(ctx, id)` loads an item or collection only if the caller owns it,
   and returns `null` otherwise, so someone else's id looks missing. Every
   mutation that takes an id goes through it, and new rows get
   `userId: ctx.userId`. Internal functions (screenshots, tagging) only patch
   existing items, so ownership carries through.

`requireUser` is the one identity seam. Swapping in a real provider later
(Better Auth, Clerk) means replacing it with `ctx.auth.getUserIdentity()` plus
a users lookup, and removing the `token` plumbing from the client.

## Managing users

```bash
# New user: prints their code once (it can't be recovered later)
npx convex run users:invite '{"name": "sam"}'

# Lost or leaked code: issue a new one; the old one stops working at once.
# Also the way to lock someone out (just don't send them the new code)
npx convex run users:resetCode '{"userId": "..."}'
```

Add `--prod` to target production. Send the person
`https://<app domain>/login?code=<code>`. They're signed in for a year per
browser. For the browser extension, they paste the same code into its token
setting.

## Browser extension

The extension's token is the user's access code; `items.add` with it works
unchanged. After merging the extension branch, two follow-ups:

- `extension/api.js` must send `token` on queries too.
- `imageImport.addFromUrl` (an action, so it has no `ctx.db`) should check the
  caller before fetching anything, with
  `await ctx.runQuery(api.users.me, { token: args.token })`, in place of the
  removed `requireAuth`.

## Rolling out to prod

The migration (`migrations/014_multi_user.ts`) creates the owner user and
backfills `userId` on every existing row. **The owner's access code is the
current `CONVEX_WRITE_TOKEN`**, so the extension keeps working, and you sign
in with `/login?code=<CONVEX_WRITE_TOKEN>`.

`userId` is required in the schema, and Convex rejects a push while existing
documents don't match, so go widen → backfill → narrow. The deployed app breaks
between steps 1 and 4: do it in one sitting. It takes a minute or two.

1. **Widen**: in `src/convex/schema.ts`, temporarily wrap `userId` on `items`,
   `collections` and `viewPreferences` in `v.optional(...)`, then deploy the
   backend:
   ```bash
   npx convex deploy
   ```
2. **Backfill**:
   ```bash
   npx convex run --prod migrations/014_multi_user:migrateToMultiUser '{"name": "yifan"}'
   ```
3. **Check** that every count is 0 (the backfill is scheduled, so give it a few
   seconds):
   ```bash
   npx convex run --prod migrations/014_multi_user:countUnowned
   ```
4. **Narrow**: revert the schema change and deploy the backend and the app:
   ```bash
   pnpm run deploy
   ```
5. **Sign in** at `/login?code=<CONVEX_WRITE_TOKEN>`. Old password cookies stop
   working, so this is needed once per browser.
6. **Clean up** secrets nothing reads any more: the worker's `AUTH_PASSWORD`
   and `CONVEX_WRITE_TOKEN` (Cloudflare dashboard or `wrangler secret delete`).
   Convex's `CONVEX_WRITE_TOKEN` is only read by the migration, so remove it
   afterwards with `npx convex env remove --prod CONVEX_WRITE_TOKEN`.

## Why access codes

The goal was the least friction and no added load time, for an app shared with
a few friends where strong security isn't the point.

| Option                    | Extra on page load                                                                | Friction                                             | External service                |
| ------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------- |
| **Access codes (chosen)** | none                                                                              | click a link once per browser                        | none                            |
| Clerk                     | SDK bundle, a token fetch from Clerk, Convex verifying the JWT before queries run | Clerk's sign-in screens                              | Clerk                           |
| Better Auth / Convex Auth | client library, a session/token fetch, JWT verification                           | signup form, password or email link                  | an email sender for magic links |
| Magic links               | as above                                                                          | an email every time the session expires              | an email sender                 |
| Cloudflare Access         | none in the app                                                                   | Cloudflare's login page; doesn't cover the extension | Cloudflare Zero Trust           |

How secure it is: about as secure as an API key. Codes are 128-bit random
values, so they can't be guessed, and a fast hash with no rate limiting is
fine. The real risk is a leaked link or cookie: whoever holds it acts as that
user until you run `resetCode`. Codes also sit in the browser's history if
opened as a link. What you give up: self-serve signup, password reset and
OAuth. If you ever want those, move to Better Auth through the seam above.

## Deliberately left for later

- **R2 image privacy.** Image URLs are public, stable `${R2_PUBLIC_URL}/${key}`.
  Keys are unguessable, but anyone holding a URL can view the image. Real
  privacy needs presigned URLs or an auth-checking proxy, both of which break
  the 1-year edge cache (see `ops.md`).
- **Per-user AI cost limits.** Tagging (OpenRouter) and screenshots (Cloudflare
  Browser Rendering) are shared and unmetered. Add a per-user quota (e.g.
  `@convex-dev/rate-limiter` keyed by `userId` in `items.add` / `retagItem`)
  before inviting anyone heavy.
- **Public or shared collections.** Everything is private to its owner; a
  logged-out visitor sees nothing. Sharing would need a `visibility` field on
  collections and a query path that doesn't require a user.
- **Account settings, renaming or deleting a user and their data** (do it by hand in the dashboard for now).
- **Pagination.** `items.list` still collects all of a user's items, as before.
