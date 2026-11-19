# Multi-user

Every item, collection and view preference belongs to a user. Users sign in
with a **username and password**. Accounts are created from one-time invite
links you mint from the CLI. There are no external auth services, and page
loads cost nothing extra: after login, a session token in a cookie does all
the work.

## Data model

- **`users`**: `{ username, passwordHash }`, indexed `by_username`. Usernames
  are stored lowercase. Passwords are hashed with PBKDF2-SHA256 (600k
  iterations, random salt; `hashPassword` in `src/convex/lib/auth.ts`).
- **`loginAttempts`**: `{ username, count, lastAttempt }`, the lockout count
  per submitted username, whether or not an account has it (see below).
  Indexed `by_username` and `by_lastAttempt`.
- **`sessions`**: `{ userId, tokenHash, extension? }`, one per signed-in
  browser plus at most one for the browser extension. Only the SHA-256 hash of
  each token is stored. Sessions don't expire; they end on logout, on
  "sign out other devices", via `users:signOut`, or when the account is
  deleted.
- **`invites`**: `{ codeHash }`, one-time signup codes. Deleted when used.
- **`uploads`**: `{ userId, key }`, R2 keys from `r2.generateUploadUrl` not yet
  attached to an item, indexed `by_key` and `by_user`. `items.add` only takes an `imageKey` the caller uploaded,
  and consumes the row, because deleting an item deletes its R2 object.
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
   session token, which the SvelteKit server stores in a one-year `session`
   cookie. It's httpOnly, but the client is handed the token anyway (step 2),
   so injected script could still read it. An invite link (`/login?invite=…`) shows the same form as
   signup instead (`sessions.signup`).
2. The `(app)` layout reads the cookie and hands the token to the client as
   `writeToken` (null without one). Its universal load (`+layout.ts`) sends a
   visitor without a token to `/login?next=…`, except on a collection page
   (see [Shared collections](#shared-collections)). The server doesn't re-check
   the token on each load, so there is no extra round trip.
3. The client sends the token as the required `token` arg on every Convex
   query and mutation (leaving it out is a type error). `userQuery` / `userMutation` call `requireUser`, which hashes the
   token, looks up the session (one indexed read) and passes `ctx.userId` to
   the handler. An unknown token throws `Unauthorized`, and the app layout (or
   `mutate()`) sends the user to `/login`, whose load clears the dead cookie.
   `/login` with a live session goes straight to the app, unless it's an invite
   link.
4. `getOwned(ctx, id)` loads an item or collection only if the caller owns it,
   and returns `null` otherwise, so someone else's id looks missing. Every
   mutation that takes an id goes through it, and new rows get
   `userId: ctx.userId`. Internal functions (screenshots, tagging) only patch
   existing items, so ownership carries through.

The account page (`/account`, the "account" link in the top bar) shows who's
signed in and lets the user copy an extension token (a new one ends the
previous extension session), change their password (`sessions.changePassword`,
which needs the current one and leaves other sessions signed in), sign out
every other session (`sessions.signOutOthers`), log out, and delete the account
(see [Deleting an account](#deleting-an-account)). Logging out deletes that
browser's session.

Every password check (at login, or the current password when changing it or
deleting the account)
counts toward a lockout _before_ the slow hash runs, in one mutation
(`sessions.countAttempt`), so parallel guesses can't race past it. After 10
attempts without a success, that username gets one attempt per 15 minutes; a
successful login or a new password (`changePassword`, `users:setPassword`)
clears the count, and a day without attempts forgets it (a daily cron sweeps
those rows).

The count is keyed by the submitted username, not the account, so login can't
tell anyone which usernames exist: a made-up name goes through the same
mutation, runs a hash against a dummy, gets the same "wrong username or
password", and locks after the same 10 misses. Names longer than 32 characters
(signup's limit) are refused before counting, so they can't fill the table.
Signup checks the invite before anything else, so only someone holding a valid
invite learns that a name is taken.

The flip side of a per-username lockout: anyone who knows a username can keep
it locked for new logins (existing sessions keep working). Locking per IP would
need a trusted client IP, which a public Convex action doesn't have. Shared
collections show their owner's username, so usernames aren't secret anyway;
the point is only that login doesn't confirm them.

`requireUser` is the one identity seam. Swapping in a real provider later
(Better Auth, Clerk) means replacing it with `ctx.auth.getUserIdentity()` plus
a users lookup, and removing the `token` plumbing from the client.

## Shared collections

A collection is private until its owner switches it to "anyone with link" in
the collection's settings menu ("copy link" does that and copies the URL). The
link is the collection's own URL, `/collections/<id>`, so the owner and a
visitor open the same page:

- **Owner**: the normal page.
- **Signed-in non-owner**: their own sidebar and top bar, with the collection
  read-only and a "by <owner>" byline.
- **Logged out**: a bar with just the logo and "log in" (which comes back to
  the collection), and the collection read-only.

Read-only means a "search this collection" box in place of the add bar, no
reordering, deleting or retrying, and an item modal without edit controls.
Visitors start from the owner's sort, view, column and title settings and can
change them for themselves; their changes are never saved.

On the backend, `viewerQuery` (in `lib/auth.ts`) is a query whose `token` is
optional; an absent or ended session is a logged-out viewer
(`ctx.viewerId === null`). `getViewable` returns a collection the caller owns
or that's shared, else null, so a private collection looks missing. Three
queries use it: `collections.get` (display fields, owner username, cover image),
`items.listByCollection` and `items.searchCollection` (the owner's search
index, narrowed to the collection). For anyone but the owner, items come back
with only `VISITOR_FIELDS` (what the page shows, notes included) and an empty
`collections` (which would reveal the owner's other collection ids); a field
added to `items` later stays owner-only until it's listed there.

`searchCollection` scans the first 256 hits of the owner's whole index and
keeps the collection's members, so in a large library a broad query can miss
members ranked below that. Search filter fields can't match inside an array,
so a real fix would need a per-collection search table.

Item links reach visitors' browsers, so they must be http(s): `items.add` /
`update` reject other schemes (`javascript:` and the like), and the UI links
only ones that pass, for rows saved before the check.

A logged-out request for a collection page loads it during SSR (`+page.ts`)
for link-preview meta tags (`og:title`, `og:image` from the newest image). It
goes through SvelteKit's `fetch`, so hydration reuses the response; signed-in
users skip it.

Collection ids aren't designed as secrets, but they're long and can't be
listed by anyone else, so the link is the access control along with the flag.
Making a collection private again cuts every visitor off; sharing it again
revives the same link. A random share key that can be rotated would be the
next step if that ever matters.

## Deleting an account

"delete account" on the account page takes the current password and a confirm
dialog, then calls `sessions.deleteAccount`. It checks the password like
`changePassword` does (`confirmPassword`: counted toward the lockout first), so
a stolen session alone can't wipe an account. Then, in one mutation
(`users.startDeletion`), every session ends, the extension's included, the
password hash becomes the dummy one (no password matches it, so nobody signs
in while the data goes) and the first batch is scheduled. The page then loads
`/login` in full, which clears the dead cookie; a full load because the app
layout, seeing its queries turn `Unauthorized`, may already be navigating to
`/login?next=…`.

`users.deleteUserData` deletes a batch and schedules itself again until
nothing is left:

1. **Collections**, one per run with up to 100 of its membership rows (more
   runs for a bigger one), so shared links stop working first. The members'
   `collections` arrays aren't patched, as the items go next.
2. **Items**, 25 a run, through `deleteItem` (what `items.remove` does): any
   remaining membership rows, the embedding, and the image's R2 object with its
   variant copies (`deleteImageObjects`).
3. **The rest in one run with the user**: `uploads` rows and their R2 objects,
   stray `itemEmbeddings`, `viewPreferences`, any session left, the
   `embeddingMapStates` / `embeddingMapLayouts` rows, the username's
   `loginAttempts` row, and last the `users` row. They're a few rows each, and
   going in the same transaction as the user means a run that finishes late
   finds the user gone instead of leaving a row behind. The username is free
   for signup again.

Work queued for the items before they went finds them missing and stops
quietly: captures, tagging, palettes, embeddings and variant runs check the
item (a capture or variant run that already stored an object deletes it), a
map layout checks the user (`embeddingMap.save`), and an upload whose row went
mid-check has its object deleted (`r2.markVerified`). A new table holding a
user's rows needs a step in `deleteUserBatch` (`users.ts`).

Never try it on the dev deployment with its copied data: dev's items point at
prod's objects in the shared R2 bucket (`ops.md`), so deleting a dev account
deletes prod's images. Tests cover it with a stubbed bucket
(`accountDeletion.test.ts`).

## Managing users

```bash
# Invite someone: prints a one-time code, shown only once
npx convex run users:invite

# Forgotten password (sessions stay signed in; known ones change on /account)
npx convex run users:setPassword '{"username": "sam", "password": "..."}'

# Sign someone out everywhere, extension included (e.g. leaked password)
npx convex run users:signOut '{"username": "sam"}'
```

Add `--prod` to target production. Send the person
`https://<app domain>/login?invite=<code>`; they pick their own username (2–32
letters, numbers, `-` or `_`) and password (8+ characters). To lock someone
out, run `signOut` and then `setPassword` with a password they don't know.

## Browser extension

"copy extension token" on the account page creates a separate session for the
extension and copies its token (or shows it if the clipboard is blocked). The
user pastes it into the extension's token setting, so the extension never sees
the password. Copying a new token ends the old one. The extension sends that
token on every call, like the app does. The `imageImport` actions have no
`ctx.db`, so they check the caller with
`ctx.runQuery(internal.users.userForToken, { token })` before fetching anything,
like every other public action.

## Per-user limits

Tagging (OpenRouter), captures (Cloudflare Browser Rendering), embeddings
(Workers AI) and R2 storage are shared, and the job queues are shared workpools,
so one user, or a script holding a session token, could run up the bill or keep
everyone else's saves waiting. `src/convex/lib/rateLimits.ts` holds one
`@convex-dev/rate-limiter` with the limits, each a token bucket keyed by
`userId`:

| Limit    | Counts                                                                                                                                                | Refill    | Burst |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ----- |
| `save`   | `items.add` (links, images, notes, the extension's saves), `screenshots.reimageItem`                                                                  | 200 a day | 50    |
| `retag`  | `tagging.retagItem`, except turning AI off                                                                                                            | 300 a day | 50    |
| `upload` | `r2.generateUploadUrl`, and the actions that fetch or store an image server-side: `imageImport.addFromUrl` / `addPageWithImage`, `discoveryKeep.keep` | 200 a day | 50    |
| `search` | `embeddings.search`                                                                                                                                   | 60 a min  | 20    |

Each function spends a token (`limitUser`) before any other work, so a refused
call costs nothing; in a mutation a later throw gives the token back. An image
for a new item counts once as an upload and once as a save: the upload step
(`limitImageUpload`) only checks that a save is left, so it's refused before any
bytes move when the item couldn't be saved, and `items.add` spends the save.
The server-side imports mint their key with `r2.mintServerUpload`, which counts
nothing, so they aren't counted twice. `imageImport.verifyUpload` isn't counted:
it runs at most once per minted key.

A refusal is a `ConvexError` like "you’ve saved a lot today, try again in about
7 minutes" (from the limiter's `retryAfter`), which the app shows as an error
toast and the extension as its failure toast. The search page and the atlas
lens call `embeddings.search` with a silent `onError`, so a refused search just
shows the keyword results.

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
compared with a hosted provider: password reset by email (you run
`setPassword` for a forgotten one), 2FA and OAuth. If you ever want those, move
to Better Auth through the seam above.

## Deliberately left for later

- **R2 image privacy.** Image URLs are public, stable `${R2_PUBLIC_URL}/${key}`.
  Keys are unguessable, but anyone holding a URL can view the image. Real
  privacy needs presigned URLs or an auth-checking proxy, both of which break
  the 1-year edge cache (see `ops.md`).
- **Profiles and discovery.** Shared collections are reachable only by link;
  there's no `/u/<username>` page listing them.
- **Saving someone else's item.** Deleting an item deletes its R2 object, so a
  copy into your own collection needs its own copy of the image.
- **Renaming a user** (do it by hand in the dashboard for now).
- **Pagination.** `items.list` is paginated, but the client still loads every
  page up front (`useAllPages`); there's no infinite scroll.
