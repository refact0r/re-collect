# Multi-user

re-collect's data model is per-user, but auth hasn't changed yet: there is one
owner account, reached through the existing password gate and write token.
This note covers what changed, how to roll it out to prod, and the open auth
decision.

## What changed

- **`users` table**: `{ name, tokenIdentifier }`, indexed `by_tokenIdentifier`.
  `tokenIdentifier` is the stable identity key the auth seam resolves to (the
  same field Convex's `ctx.auth.getUserIdentity()` returns).
- **`userId` on owned tables**: `items`, `collections`, `viewPreferences`.
  Indexes are user-first: `items.by_user_dateAdded` / `by_user_dateModified`,
  `collections.by_user_position`, `viewPreferences.by_user_key`, and the
  `search_items` search index filters on `userId`. `itemCollectionPositions`
  has no `userId`: its rows are only reached through an owned item or
  collection, and `addItemToCollection` refuses to link an item and collection
  with different owners.
- **One identity seam** (`src/convex/lib/auth.ts`):
  - `requireIdentity(ctx, token)` is the only place that knows how a caller
    is identified. It returns a `tokenIdentifier` and needs no database, so
    actions can call it too. Today the shared `CONVEX_WRITE_TOKEN` resolves to
    the owner (`tokenIdentifier: 'owner'`).
  - `requireUser(ctx, token)` looks the identity up in `users`, or throws
    `Unauthorized`.
  - `userQuery` / `userMutation` replace `authedMutation`. They add the
    optional `token` arg, resolve it, and pass `ctx.userId` to the handler.
    Every public function uses them, queries included.
  - `getOwned(ctx, id)` loads an item or collection only if the caller owns it,
    and returns `null` otherwise, so someone else's id looks missing.
- **Scoping**: every query filters by `ctx.userId`; every mutation that takes
  an item or collection id goes through `getOwned`; new rows get
  `userId: ctx.userId`. Internal functions (screenshots, tagging) only patch
  existing items, so ownership carries through unchanged.
- **Logged-out visitors get nothing**: the read-only public mode is gone. The
  `(app)` layout redirects to `/login` when there is no valid session. Public
  collections can come later.
- **Browser extension**: `items.add` with the write token still works and the
  item lands on the owner. After merging the extension branch, two follow-ups:
  `extension/api.js` must send `token` on queries too, and
  `imageImport.addFromUrl` (an action) should call
  `await requireIdentity(ctx, args.token)` instead of the removed `requireAuth`.
- **Migration** `migrations/014_multi_user.ts`: `migrateToMultiUser` creates the
  owner user (idempotent) and schedules batched `userId` backfills per table;
  `countUnowned` reports rows still missing one.

## Rolling out to prod

`userId` is required in the schema, and Convex rejects a push while existing
documents don't match. So go widen → backfill → narrow. The app's queries need
the new token args, so the old app breaks between steps 1 and 4: do it in one
sitting. It takes a minute or two.

1. **Widen**: in `src/convex/schema.ts`, temporarily wrap `userId` on `items`,
   `collections` and `viewPreferences` in `v.optional(...)` (the branch's first
   commit, "multi-user data model…", is exactly that state), then deploy the
   backend:
   ```bash
   npx convex deploy
   ```
2. **Backfill** (pass your name if you like):
   ```bash
   npx convex run --prod migrations/014_multi_user:migrateToMultiUser '{"name": "yifan"}'
   ```
3. **Check** that every count is 0 (the backfill is scheduled, so give it a few
   seconds):
   ```bash
   npx convex run --prod migrations/014_multi_user:countUnowned
   ```
4. **Narrow**: revert the schema change and deploy both the backend and the app:
   ```bash
   pnpm run deploy
   ```

No env var changes are needed: `CONVEX_WRITE_TOKEN` stays as is.

## The open decision: auth

Whatever you pick, the change on the Convex side stays in
`requireIdentity` (plus dropping the `token` arg from the wrappers and
client calls if the provider sends a JWT instead). New users need a `users` row
with their `tokenIdentifier`, created on first sign-in or by an invite flow.
To move the owner over, set the owner row's `tokenIdentifier` to your new
identity.

| Option                                        | How it fits                                                                                                                                                                                                                                 | Effort                                                                                                 | Downsides                                                                                                                            |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Per-user tokens + invite links**            | Generalizes today's model. Each user row holds a hash of a random secret; an invite/login link sets the session cookie, and the SvelteKit server hands that user's token to the client. `requireIdentity` hashes the token and looks it up. | Smallest: a `tokenHash` field and index, a link-redeem route, a script or mutation that mints invites. | Homemade. No password reset or OAuth: a lost cookie means you send a new link. Tokens are bearer secrets, so rotate one if it leaks. |
| **Convex Auth** (password, magic link, OAuth) | Lives in Convex. Its `authTables` replace our `users`, and `getAuthUserId(ctx)` becomes the seam.                                                                                                                                           | Medium. Magic links need an email sender such as Resend.                                               | Officially React-first; SvelteKit relies on community bindings. Check that it's still actively maintained.                           |
| **Better Auth** (Convex component)            | Open-source and runs on your Convex deployment. Email/password, magic link, OAuth and invite or admin plugins. The seam becomes `ctx.auth.getUserIdentity()`.                                                                               | Medium: component setup, `auth.config.ts`, and a SvelteKit client.                                     | The most moving parts. Check its SvelteKit + Convex support before committing.                                                       |
| **Clerk**                                     | Hosted sign-in UI and user management, with a JWT to Convex through `auth.config.ts`. The seam becomes `ctx.auth.getUserIdentity()`.                                                                                                        | Low code, but you configure an external service.                                                       | A third-party vendor holding your users. The Svelte SDK is community-maintained. Overkill for a few friends.                         |
| **Allowlist only**                            | Add an email allowlist on top of any of the above; it's just a check at user creation.                                                                                                                                                      | Trivial.                                                                                               | It's a gate, not auth by itself.                                                                                                     |

**Recommendation:** for "me and a few friends", start with **per-user tokens and
invite links**. It is the smallest step from today, has no vendor, and gives
every user a token for the browser extension too. Move to **Better Auth** if
you later want self-serve signup, password reset or OAuth. The seam means that
move touches one function and the client's token plumbing.

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
- **Signup/login UI, account settings, deleting a user and their data.**
- **Pagination.** `items.list` still collects all of a user's items, as before.
