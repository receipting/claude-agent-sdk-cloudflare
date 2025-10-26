# Claude Agent SDK + Cloudflare Containers

Cloudflare containers are such good fit for Claude Agent SDK because they work differently than other container solutions. Instead of just a container, you get three components: a Worker (serverless compute), a Durable Object (storage), and a Container (isolated Agent runtime).

You use the Worker to set up context (sql queries etc) allowing you to triage requests to make sure they actually need an agent to solve them before even starting the container. So fast, so economical, so good!

## Prerequisites

```bash
npm install -g wrangler  # Cloudflare CLI
```

Get your Anthropic API key from https://console.anthropic.com/settings/keys

## Quickstart

```bash
# 1. Install dependencies
npm install && cd container && npm install && cd ..

# 2. Create config with your Anthropic API key
cat > .dev.vars << EOF
ANTHROPIC_API_KEY=sk-ant-your-api-key-here
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

**"ANTHROPIC_API_KEY not set"**
- Check `.dev.vars` exists and contains your API key
- Get your API key from https://console.anthropic.com/settings/keys
- Key must start with `sk-ant-`

**"Container failed to start"**
- First run builds Docker image (~30 seconds)
- Check `docker ps` to see if container is running
- Try `wrangler dev --local` for faster local testing

**Rate limits or quota errors**
- Check your Anthropic API usage at https://console.anthropic.com/settings/limits
- Upgrade your plan if needed

## How it works

```
Request → Worker → DO.idFromName(accountId) → Container → Claude SDK
```

- Same `accountId` = same Durable Object = serialized requests
- Different `accountId` = different Durable Objects = parallel execution
- Containers stay warm 5 minutes (`sleepAfter` in server.ts)

**Learn more:** [Claude Agent SDK Documentation](https://docs.claude.com/en/api/agent-sdk/overview#core-concepts)

## Agent Skills

This repo demonstrates how to set up [Agent Skills](https://docs.claude.com/en/docs/agents-and-tools/agent-skills/overview) in containers (current best practice, though this may change in future SDK versions). Skills are modular capabilities that transform Claude from a general-purpose assistant into a domain specialist, packaging instructions and resources that Claude uses automatically when relevant. By enabling progressive disclosure of specialized knowledge, skills eliminate repetition and context overhead—making them the recommended approach for production Agent SDK deployments.

**Included:** The `skill-test` skill in `.claude/skills/skill-test/` verifies the skills system is working.

**Critical requirement:** The container **cannot run as root** when using `bypassPermissions` mode. The Claude CLI explicitly rejects the `--dangerously-skip-permissions` flag (which bypass mode maps to) when running as root user. This is a security measure to prevent accidental privilege escalation. The Dockerfile switches to the `node` user before running the agent (`USER node`).

**Key setup requirements:**
- `.claude/skills/` directory copied into container (see `Dockerfile`:21)
- `settingSources: ['local', 'project']` in query options (see `container/server.ts`:36)
- `permissionMode: 'bypassPermissions'` for autonomous operation (see `container/server.ts`:37)
- Container runs as non-root user: `USER node` (see `Dockerfile`:25)

**Test it:**
```bash
./test-skill.sh 8787
```

## Deploy

```bash
npm run deploy
wrangler secret put ANTHROPIC_API_KEY  # Prompts for Anthropic API key
wrangler secret put API_KEY  # Prompts for your API auth key
wrangler secret put MODEL  # Optional: defaults to claude-sonnet-4-5
```

## Configuration

**Environment variables (.dev.vars for local, wrangler secret for production):**
```bash
ANTHROPIC_API_KEY=sk-ant-...  # Get from https://console.anthropic.com/settings/keys
API_KEY=your-secret-key-here  # Your own API auth key for protecting the endpoint
MODEL=claude-sonnet-4-5  # Optional, defaults to claude-sonnet-4-5
```

### Alternative: OAuth Token (Requires Anthropic Permission)

If you have permission from Anthropic to use Claude Code OAuth tokens (see [authentication docs](https://docs.claude.com/en/api/agent-sdk/overview#core-concepts)):

**Prerequisites:**
```bash
npm install -g @anthropic-ai/claude-code
```

**Setup:**
```bash
claude setup-token  # Opens browser, copy token from terminal
cat > .dev.vars << EOF
CLAUDE_CODE_OAUTH_TOKEN=sk-ant-your-oauth-token-here
MODEL=claude-sonnet-4-5
API_KEY=your-secret-key-here
EOF
```

**Deploy:**
```bash
wrangler secret put CLAUDE_CODE_OAUTH_TOKEN
```

Note: OAuth tokens require prior approval from Anthropic. For most users, use `ANTHROPIC_API_KEY` instead.

**server.ts:**
```typescript
sleepAfter = "5m";  // How long containers stay warm
const accountId = body.accountId || "default";  // Isolation key
```

**wrangler.toml:**
```toml
instance_type = "standard-2"  # basic | standard-1/2/3/4
max_instances = 60
```

## License

MIT
