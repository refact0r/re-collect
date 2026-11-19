# privacy

re-collect is a small, invite-only app run by one person. this is what it keeps and where it goes.

last updated 2026-11-19

## what's collected

- **your account**: a username, and your password stored only as a salted hash.
- **your sessions**: one cookie that keeps you signed in, plus a token if you connect the browser extension. the server stores only hashes of these.
- **what you save**: links, uploaded images, notes and collections, and what's made from them: screenshots, ai tags, colors, fonts and search embeddings.
- **the waitlist**: your email, if you leave it on the landing page. it's used only to send you an invite.
- failed sign-ins are counted per username for up to a day, to slow down password guessing.

## who processes it

- **convex** runs the database and backend. everything above is stored there.
- **cloudflare** hosts the site, stores images (r2), takes screenshots of the links you save (browser rendering) and makes the embeddings for search (workers ai).
- **openrouter** runs ai tagging, and passes the item's image or text on to the model's provider.

ai can be turned off per collection or per item ("understood by: off"). an item with it off is never sent to any ai service.

the discovery feed pulls from public design sites and sends them none of your data. its images load straight from those sites, like on any web page.

these services keep their own logs under their own policies.

## who can see it

everything is private by default. if you share a collection by link, anyone with the link can see it, its items (notes included) and your username.

image files are served from public but unguessable urls, so anyone who has an image's url can open it.

## what isn't done

no ads, no analytics or tracking, and your data is never sold.

## deleting

the account page deletes your account and everything in it, images included, though copies of an image can stay in cloudflare's cache for a while after, for anyone who has its url.

to get off the waitlist, or for anything else, open an issue on [github.com/refact0r/re-collect](https://github.com/refact0r/re-collect/issues) or reach out to [@refact0r](https://github.com/refact0r) on github.

## changes

this may change. every change shows up in this file's history.
