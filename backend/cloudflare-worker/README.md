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
