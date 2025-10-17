# Claude Agent SDK on Cloudflare Containers

Run Claude Agent SDK in Cloudflare's container runtime. Each `accountId` gets its own Durable Object → isolated container → serialized execution.

**New Features:**
- 🗄️ **Conversation Storage**: Persistent conversation history with SQLite
- 🗑️ **Automatic Purge**: 30-day retention with cron-based cleanup
- 📊 **Storage Monitoring**: Real-time stats and metrics
- 🔄 **Session Management**: Multi-turn conversations with session IDs

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
{
  "success": true, 
  "response": "4",
  "session_id": "session_1234567890_abc123"
}
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

## API Endpoints

### Query with Session Support
```bash
# Create new conversation (auto-generates session_id)
curl -X POST http://localhost:8787/query \
  -H "Content-Type: application/json" \
  -d '{"query": "Hello!", "accountId": "user123"}'

# Continue existing conversation
curl -X POST http://localhost:8787/query \
  -H "Content-Type: application/json" \
  -d '{"query": "Follow up question", "accountId": "user123", "session_id": "session_abc"}'
```

### Storage Statistics
```bash
curl http://localhost:8787/storage-stats?accountId=user123
# Returns: total conversations, oldest age, conversations ready to purge
```

### List Conversations
```bash
curl http://localhost:8787/conversations?accountId=user123&limit=50&offset=0
```

### Get Specific Conversation
```bash
curl http://localhost:8787/conversations/session_abc?accountId=user123
```

### Delete Conversation
```bash
curl -X DELETE http://localhost:8787/conversations/session_abc?accountId=user123
```

### Manual Purge (for testing)
```bash
curl -X POST http://localhost:8787/purge?accountId=user123
```

### Test Suite
```bash
# Run comprehensive test suite
./test-purge.sh

# Or with custom settings
BASE_URL=http://localhost:8787 ACCOUNT_ID=test-user ./test-purge.sh
```

## How it works

```
Request → Worker → DO.idFromName(accountId) → Container → Claude SDK
```

- Same `accountId` = same Durable Object = serialized requests
- Different `accountId` = different Durable Objects = parallel execution
- Containers stay warm 20 minutes (`sleepAfter` in server.ts)

### Conversation Storage

Each Durable Object has SQLite storage for conversations:

```
Durable Object (per accountId)
├── SQLite Database
│   ├── conversations table (session_id, account_id, timestamps, metadata)
│   └── messages table (role, content, timestamp)
└── Container (Claude SDK)
```

- **Automatic storage**: Every query is stored with a session_id
- **Multi-turn conversations**: Use same session_id for context
- **Indexed queries**: Fast lookups by session_id and last_accessed_at
- **Cascade deletion**: Messages auto-delete when conversation is deleted

### Automatic Purge (30-Day Retention)

**Cron-based purge** runs daily at 2 AM UTC:

```toml
# wrangler.toml
[triggers]
crons = ["0 2 * * *"]
```

- **Threshold**: Conversations older than 30 days (based on `last_accessed_at`)
- **Zero impact**: Runs independently of user requests
- **Logged**: All purge operations are logged with deletion counts
- **Manual trigger**: Use `/purge` endpoint for testing

**Test cron trigger:**
```bash
# Deploy first
npx wrangler deploy

# Trigger cron manually
npx wrangler triggers cron

# Watch logs
npx wrangler tail
```

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

## Documentation

- **[PURGE_IMPLEMENTATION.md](./PURGE_IMPLEMENTATION.md)**: Detailed documentation on conversation storage and purge system
- **[CONVERSATION_PURGE_PLAN.md](./CONVERSATION_PURGE_PLAN.md)**: Original implementation plan and design decisions

## License

MIT
