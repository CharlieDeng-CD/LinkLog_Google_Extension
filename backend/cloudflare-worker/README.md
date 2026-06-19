# LinkLog Cloudflare Worker

This worker proxies LinkLog extension requests to DeepSeek without exposing your DeepSeek API key in the Chrome extension bundle.

## Deploy

1. Copy the example config:

```bash
cp backend/cloudflare-worker/wrangler.toml.example backend/cloudflare-worker/wrangler.toml
```

2. In `backend/cloudflare-worker`, set the secret:

```bash
wrangler secret put DEEPSEEK_API_KEY
```

3. Deploy:

```bash
wrangler deploy
```

4. Use the deployed worker URL as:

```text
https://YOUR_WORKER.workers.dev
```

The extension will call:

```text
https://YOUR_WORKER.workers.dev/chat/completions
```

## Optional Rate Limit

Create a KV namespace and bind it as `LINKLOG_RATE_LIMIT_KV` to enable simple per-IP hourly limits. The default limit is `60` requests per hour.

## Optional Anonymous Analytics

LinkLog can collect lightweight anonymous product analytics through the hosted Worker. It does **not** store page content, source URLs, or raw selected concepts.

Tracked fields include:

- Event name, for example `map_generation_succeeded`
- UI language
- Extension version
- Anonymous install ID
- Selected concept hash and concept length
- Node/child counts
- Page hostname only, not full URL
- Error category when a request fails

Create a KV namespace:

```bash
npx wrangler kv namespace create LINKLOG_ANALYTICS_KV
```

Then add the returned namespace id to `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "LINKLOG_ANALYTICS_KV"
id = "your-analytics-kv-namespace-id"
```

For private analytics summary access, set an admin token:

```bash
npx wrangler secret put LINKLOG_ANALYTICS_ADMIN_TOKEN
```

Deploy:

```bash
npx wrangler deploy
```

Query the last 7 days:

```bash
curl -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  "https://linklog-api.linklog.workers.dev/analytics/summary?days=7"
```

Include the latest anonymous events:

```bash
curl -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  "https://linklog-api.linklog.workers.dev/analytics/summary?days=7&recent=1"
```
