# Claude Agent SDK on Cloudflare Containers

Run Claude Agent SDK in Cloudflare's container runtime. Each `accountId` gets its own Durable Object → isolated container → serialized execution.

## Prerequisites

```bash
npm install -g wrangler  # Cloudflare CLI
npm install -g @anthropic-ai/claude-code  # For getting OAuth token
```

## Quickstart

```bash
# 1. Install dependencies
npm install && cd container && npm install && cd ..

# 2. Get OAuth token (opens browser, copy token from terminal)
claude setup-token
echo "CLAUDE_CODE_OAUTH_TOKEN=paste-token-here" > .dev.vars

# 3. Start dev server (first run builds container image, takes ~30s)
npm run dev
```

**When you see:** `Ready on http://localhost:XXXX`

```bash
# 4. Test it (use the port from above)
./test.sh 8787

# Or manually:
curl -X POST http://localhost:8787/query \
  -H "Content-Type: application/json" \
  -d '{"query": "What is 2+2?"}'
```

**Expected response:**
```json
{"success": true, "response": "4"}
```

## Troubleshooting

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
wrangler secret put CLAUDE_CODE_OAUTH_TOKEN
```

## Configuration

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
