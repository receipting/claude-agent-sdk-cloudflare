# Quick Reference: Conversation Storage & Purge

## 🚀 Quick Start

```bash
# 1. Start dev server
npm run dev

# 2. Run tests
./test-purge.sh

# 3. Deploy to production
npx wrangler deploy

# 4. Test cron trigger
npx wrangler triggers cron
```

## 📡 API Endpoints

### Create/Continue Conversation
```bash
# New conversation (auto-generates session_id)
curl -X POST http://localhost:8787/query \
  -H "Content-Type: application/json" \
  -d '{"query": "Hello!", "accountId": "user123"}'

# Continue conversation (use existing session_id)
curl -X POST http://localhost:8787/query \
  -H "Content-Type: application/json" \
  -d '{"query": "Follow up", "accountId": "user123", "session_id": "session_abc"}'
```

### Monitor Storage
```bash
# Get storage statistics
curl http://localhost:8787/storage-stats?accountId=user123

# List all conversations
curl http://localhost:8787/conversations?accountId=user123

# Get specific conversation
curl http://localhost:8787/conversations/session_abc?accountId=user123
```

### Manage Conversations
```bash
# Delete conversation
curl -X DELETE http://localhost:8787/conversations/session_abc?accountId=user123

# Manual purge (testing)
curl -X POST http://localhost:8787/purge?accountId=user123
```

## 🗄️ Database Schema

```sql
-- Conversations
CREATE TABLE conversations (
  session_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_accessed_at INTEGER NOT NULL,
  metadata TEXT
);

-- Messages (cascade delete)
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES conversations(session_id) ON DELETE CASCADE
);
```

## ⏰ Automatic Purge

**Schedule**: Daily at 2 AM UTC  
**Retention**: 30 days  
**Criteria**: `last_accessed_at < (now - 30 days)`

```toml
# wrangler.toml
[triggers]
crons = ["0 2 * * *"]
```

## 🧪 Testing Commands

```bash
# Run full test suite
./test-purge.sh

# Custom configuration
BASE_URL=http://localhost:8787 ACCOUNT_ID=test ./test-purge.sh

# Individual tests
curl http://localhost:8787/health
curl http://localhost:8787/storage-stats?accountId=test
curl -X POST http://localhost:8787/purge?accountId=test
```

## 📊 Response Examples

### Query Response
```json
{
  "success": true,
  "response": "The answer is 4",
  "session_id": "session_1697500000000_abc123"
}
```

### Storage Stats Response
```json
{
  "total_conversations": 42,
  "oldest_conversation_age_days": 15.5,
  "conversations_ready_to_purge": 3,
  "retention_policy_days": 30
}
```

### Purge Response
```json
{
  "deleted": 5,
  "errors": 0
}
```

## 🔧 Configuration

### Environment Variables (Optional)
```bash
# .dev.vars or wrangler.toml [vars]
RETENTION_DAYS=30
ENABLE_AUTO_PURGE=true
```

### Wrangler Configuration
```toml
# wrangler.toml
[triggers]
crons = ["0 2 * * *"]  # Daily at 2 AM UTC

[[migrations]]
tag = "v1"
new_sqlite_classes = ["AgentContainer"]
```

## 🐛 Troubleshooting

| Issue | Solution |
|-------|----------|
| Cron not running | Deploy first: `npx wrangler deploy` |
| Conversations not purging | Check logs: `npx wrangler tail` |
| Type errors in IDE | Expected - types from Cloudflare runtime |
| Storage stats show 0 | Create conversations first via `/query` |

## 📚 Documentation

- **[PURGE_IMPLEMENTATION.md](./PURGE_IMPLEMENTATION.md)**: Full implementation guide
- **[CONVERSATION_PURGE_PLAN.md](./CONVERSATION_PURGE_PLAN.md)**: Original plan
- **[IMPLEMENTATION_SUMMARY.md](./IMPLEMENTATION_SUMMARY.md)**: What was built
- **[README.md](./README.md)**: Main documentation

## 🎯 Key Features

✅ Automatic conversation storage  
✅ 30-day retention with cron purge  
✅ Session-based multi-turn conversations  
✅ Real-time storage monitoring  
✅ Zero-impact on user requests  
✅ Per-account isolation  
✅ Comprehensive test suite  

## 🚀 Deployment Checklist

- [ ] Test locally: `npm run dev` + `./test-purge.sh`
- [ ] Deploy: `npx wrangler deploy`
- [ ] Set secret: `npx wrangler secret put CLAUDE_CODE_OAUTH_TOKEN`
- [ ] Test cron: `npx wrangler triggers cron`
- [ ] Monitor: `npx wrangler tail`
- [ ] Verify storage: `curl https://your-worker.workers.dev/storage-stats?accountId=default`
