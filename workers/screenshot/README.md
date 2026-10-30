# Screenshot Worker

Cloudflare Worker that captures website screenshots using Browser Rendering API.

## Prerequisites

1. Cloudflare account with Workers and Browser Rendering enabled
2. R2 bucket created (must match the bucket used by the main app)

## Setup

1. Install dependencies (from the repo root; the worker is a pnpm workspace package):

   ```bash
   pnpm install
   ```

2. Check `bucket_name` in `wrangler.toml` matches the app's R2 bucket (`re-collect`)

3. Set up API key as a secret (from this directory):

   ```bash
   pnpm exec wrangler secret put API_KEY
   ```

   Enter a secure random string when prompted.

4. Deploy the worker (from the repo root):

   ```bash
   pnpm run deploy:screenshot
   ```

5. Note the worker URL (e.g., `https://screenshot-worker.<your-subdomain>.workers.dev`)

6. Configure Convex environment variables in the Convex dashboard:
   - `CLOUDFLARE_SCREENSHOT_URL`: Your worker URL
   - `CLOUDFLARE_SCREENSHOT_KEY`: The API key you set above

## Development

Run locally:

```bash
pnpm run dev
```

View logs:

```bash
pnpm run tail
```

## API

### POST /

Takes a screenshot of a URL and uploads it to R2.

**Headers:**

- `Authorization: Bearer <API_KEY>`
- `Content-Type: application/json`

**Body:**

```json
{
	"url": "https://example.com",
	"itemId": "abc123",
	"mode": "og"
}
```

`mode` is optional: `"og"` tries the page's og:image first (via a plain fetch,
then via the browser), falling back to a screenshot; `"screenshot"` (default)
always captures a viewport screenshot. A stored og:image is returned under an
`og/` key with its own dimensions instead.

**Response (success):**

```json
{
	"imageKey": "screenshots/abc123-1234567890.webp",
	"width": 1440,
	"height": 900,
	"captureTimeMs": 8000,
	"title": "Example Domain",
	"description": "..."
}
```

**Response (error):**

```json
{
	"error": "Failed to capture screenshot"
}
```

## Limitations

- Screenshots are 1440x900 viewport (not full page)
- 10 second navigation timeout, then up to 10s waiting for network idle plus a
  forced 5s settle delay before capture
- og:images narrower than 400px are rejected in favor of a screenshot
- Blocked URLs: localhost, private/link-local IPs (v4 and v6), .local/.internal domains
- Only HTTP/HTTPS URLs allowed
