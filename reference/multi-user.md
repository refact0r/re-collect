# Multi-user

Every item, collection and view preference belongs to a user. Users sign in
with a **username and password**. Accounts are created from one-time invite
links you mint from the CLI. There are no external auth services, and page
loads cost nothing extra: after login, a session token in a cookie does all
the work.

## Data model

- **`users`**: `{ username, passwordHash, failedLogins?, lastFailedLogin? }`,
  indexed `by_username`. Usernames are stored lowercase. Passwords are hashed
  with PBKDF2-SHA256 (600k iterations, random salt; `hashPassword` in
  `src/convex/lib/auth.ts`).
- **`sessions`**: `{ userId, tokenHash }`, one per signed-in browser or browser
  extension. Only the SHA-256 hash of each token is stored.
- **`invites`**: `{ codeHash }`, one-time signup codes. Deleted when used.
- **`userId` on owned tables**: `items`, `collections`, `viewPreferences`.
  Indexes are user-first: `items.by_user_dateAdded` / `by_user_dateModified`,
  `collections.by_user_position`, `viewPreferences.by_user_key`, and the
  `search_items` search index filters on `userId`. `itemCollectionPositions`
  has no `userId`: its rows are only reached through an owned item or
  collection, and `addItemToCollection` refuses to link an item and collection
  with different owners.

## How a request is authenticated

1. The login page (`/login`) posts the username and password to the
   `sessions.login` action. It verifies the password and returns a new random
   session token, which the SvelteKit server stores in a one-year, httpOnly
   `session` cookie. An invite link (`/login?invite=…`) shows the same form as
   signup instead (`sessions.signup`).
2. The `(app)` layout reads the cookie and hands the token to the client as
   `writeToken`. A request without the cookie is redirected to `/login`. The
   server doesn't re-check the token on each load, so there is no extra round
   trip.
3. The client sends the token as the `token` arg on every Convex query and
   mutation. `userQuery` / `userMutation` call `requireUser`, which hashes the
   token, looks up the session (one indexed read) and passes `ctx.userId` to
   the handler. An unknown token throws `Unauthorized`, and the app layout then
   sends the user back to `/login`.
4. `getOwned(ctx, id)` loads an item or collection only if the caller owns it,
   and returns `null` otherwise, so someone else's id looks missing. Every
   mutation that takes an id goes through it, and new rows get
   `userId: ctx.userId`. Internal functions (screenshots, tagging) only patch
   existing items, so ownership carries through.

Logging out deletes that browser's session. After 10 wrong passwords in a row,
each further attempt for that username has to wait 15 minutes; a successful
login or `users:setPassword` clears the count.

`requireUser` is the one identity seam. Swapping in a real provider later
(Better Auth, Clerk) means replacing it with `ctx.auth.getUserIdentity()` plus
a users lookup, and removing the `token` plumbing from the client.

## Managing users

```bash
# Invite someone: prints a one-time code, shown only once
npx convex run users:invite

# Forgotten password (sessions stay signed in)
npx convex run users:setPassword '{"username": "sam", "password": "..."}'

# Sign someone out everywhere, extension included (e.g. leaked password)
npx convex run users:signOut '{"username": "sam"}'
```

Add `--prod` to target production. Send the person
`https://<app domain>/login?invite=<code>`; they pick their own username (2–32
letters, numbers, `-` or `_`) and password (8+ characters). To lock someone
out, run `signOut` and then `setPassword` with a password they don't know.

## Browser extension

The "extension token" button in the header creates a separate session for the
extension and copies its token (or shows it if the clipboard is blocked). The
user pastes it into the extension's token setting, so the extension never sees
the password. `items.add` with that token works unchanged. After merging the
extension branch, two follow-ups:

- `extension/api.js` must send `token` on queries too.
- `imageImport.addFromUrl` (an action, so it has no `ctx.db`) should check the
  caller before fetching anything, with
  `await ctx.runQuery(api.users.me, { token: args.token })`, in place of the
  removed `requireAuth`.

## Rolling out to prod

The migration (`migrations/014_multi_user.ts`) creates your owner account with
the username and password you pass, and backfills `userId` on every existing
row. **The current `CONVEX_WRITE_TOKEN` becomes one of your sessions**, so an
extension already set up with it keeps working.

`userId` is required in the schema, and Convex rejects a push while existing
documents don't match, so go widen → backfill → narrow. The deployed app breaks
between steps 1 and 4: do it in one sitting. It takes a minute or two.

1. **Widen**: in `src/convex/schema.ts`, temporarily wrap `userId` on `items`,
   `collections` and `viewPreferences` in `v.optional(...)`, then deploy the
   backend:
   ```bash
   npx convex deploy
   ```
2. **Backfill and create your account**:
   ```bash
   npx convex run --prod migrations/014_multi_user:migrateToMultiUser '{"username": "yifan", "password": "..."}'
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
5. **Sign in** with your username and password. Old password-gate cookies stop
   working, so this is needed once per browser.
6. **Clean up** secrets nothing reads any more: the worker's `AUTH_PASSWORD`
   and `CONVEX_WRITE_TOKEN` (Cloudflare dashboard or `wrangler secret delete`).
   Convex's `CONVEX_WRITE_TOKEN` is only read by the migration, so remove it
   afterwards with `npx convex env remove --prod CONVEX_WRITE_TOKEN`.

## Why this design

The goals were a login that feels normal to non-technical friends, no added
load time, and no outside services.

| Option                    | Extra on page load                                                                | Friction                                             | External service      |
| ------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------- | --------------------- |
| **Passwords (chosen)**    | none                                                                              | log in once per browser                              | none                  |
| Access codes              | none                                                                              | a long code or link instead of a password            | none                  |
| Clerk                     | SDK bundle, a token fetch from Clerk, Convex verifying the JWT before queries run | Clerk's sign-in screens                              | Clerk                 |
| Better Auth / Convex Auth | client library, a session/token fetch, JWT verification                           | signup form, password or email link                  | an email sender       |
| Magic links               | as above                                                                          | an email every time the session expires              | an email sender       |
| Cloudflare Access         | none in the app                                                                   | Cloudflare's login page; doesn't cover the extension | Cloudflare Zero Trust |

Security: passwords are slow-hashed and salted, guessing is throttled, and
session tokens are 128-bit random values stored only as hashes. What's missing
compared with a hosted provider: password reset by email, 2FA, OAuth, and
self-serve password changes (you run `setPassword`). If you ever want those,
move to Better Auth through the seam above.

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
