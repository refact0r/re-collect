# Screenshot Worker

Cloudflare Worker that captures website screenshots using Browser Rendering API.

## Prerequisites

1. Cloudflare account with Workers and Browser Rendering enabled
2. R2 bucket created (must match the bucket used by the main app)
3. Wrangler CLI installed: `npm install -g wrangler`

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Update `wrangler.toml`:
   - Set `bucket_name` to your R2 bucket name

3. Set up API key as a secret:
   ```bash
   wrangler secret put API_KEY
   ```
   Enter a secure random string when prompted.

4. Deploy the worker:
   ```bash
   npm run deploy
   ```

5. Note the worker URL (e.g., `https://screenshot-worker.<your-subdomain>.workers.dev`)

6. Configure Convex environment variables in the Convex dashboard:
   - `CLOUDFLARE_SCREENSHOT_URL`: Your worker URL
   - `CLOUDFLARE_SCREENSHOT_KEY`: The API key you set above

## Development

Run locally:
```bash
npm run dev
```

View logs:
```bash
npm run tail
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
  "itemId": "abc123"
}
```

**Response (success):**
```json
{
  "imageKey": "screenshots/abc123-1234567890.webp",
  "width": 1200,
  "height": 800
}
```

**Response (error):**
```json
{
  "error": "Failed to capture screenshot"
}
```

## Limitations

- Screenshots are 1200x800 viewport (not full page)
- 30 second timeout for page load
- Blocked URLs: localhost, private IPs, .local domains
- Only HTTP/HTTPS URLs allowed
