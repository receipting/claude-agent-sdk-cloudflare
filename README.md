# Claude Agent SDK + Cloudflare Containers

Cloudflare containers are such good fit for Claude Agent SDK because the work differently than other container solutions. You get three components: a Worker (serverless compute), a Durable Object (storage), and a Container (isolated Agent runtime).

You use the Worker to set up context (sql queries etc) allowing you to triage requests to make sure they actually need an agent to solve them before even starting the container. So fast, so economical, so good!

## Prerequisites

```bash
npm install -g wrangler  # Cloudflare CLI
npm install -g @anthropic-ai/claude-code  # For getting OAuth token
```

## Quickstart

```bash
# 1. Install dependencies
npm install && cd container && npm install && cd ..

# 2. Get OAuth token and create config (opens browser, copy token from terminal)
claude setup-token
cat > .dev.vars << EOF
CLAUDE_CODE_OAUTH_TOKEN=paste-token-here
MODEL=claude-sonnet-4-5
API_KEY=your-secret-key-here
EOF

# 3. Start dev server (first run builds container image, takes ~30s)
npm run dev
```

**When you see:** `Ready on http://localhost:XXXX`

```bash
# 4. Test it (use the port from above)
./test.sh 8787

# Or manually (replace YOUR_API_KEY with value from .dev.vars):
curl -X POST http://localhost:8787/query \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{"query": "What is 2+2?"}'
```

**Expected response:**
```json
{"success": true, "response": "4"}
```

## Troubleshooting

**"Unauthorized"**
- Check `Authorization: Bearer <API_KEY>` header is included
- Verify API_KEY in `.dev.vars` matches the header value

**"CLAUDE_CODE_OAUTH_TOKEN not set"**
- Check `.dev.vars` exists and contains your token
- Token must start with `sk-ant-`

**"Container failed to start"**
- First run builds Docker image (~30 seconds)
- Check `docker ps` to see if container is running
- Try `wrangler dev --local` for faster local testing

**"command not found: claude"**
```bash
npm install -g @anthropic-ai/claude-code
```

## How it works

```
Request → Worker → DO.idFromName(accountId) → Container → Claude SDK
```

- Same `accountId` = same Durable Object = serialized requests
- Different `accountId` = different Durable Objects = parallel execution
- Containers stay warm 20 minutes (`sleepAfter` in server.ts)

## Deploy

```bash
npm run deploy
wrangler secret put CLAUDE_CODE_OAUTH_TOKEN  # Prompts for token
wrangler secret put API_KEY  # Prompts for API key
wrangler secret put MODEL  # Optional: defaults to claude-sonnet-4-5
```

## Configuration

**Environment variables (.dev.vars for local, wrangler secret for production):**
```bash
CLAUDE_CODE_OAUTH_TOKEN=sk-ant-...
API_KEY=your-secret-key-here
MODEL=claude-sonnet-4-5  # Optional, defaults to claude-sonnet-4-5
```

**server.ts:**
```typescript
sleepAfter = "20m";  // How long containers stay warm
const accountId = body.accountId || "default";  // Isolation key
```

**wrangler.toml:**
```toml
instance_type = "standard-2"  # basic | standard-1/2/3/4
max_instances = 60
```

## License

MIT
