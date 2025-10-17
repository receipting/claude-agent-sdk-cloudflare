# Migration Guide: Adding Conversation Storage & Purge

## Overview

This guide helps you migrate from the stateless version to the new conversation storage and purge system.

## ✅ Zero Breaking Changes

**Good news**: This implementation is **100% backward compatible**. Existing deployments will continue to work without any changes.

### What Stays the Same
- ✅ Existing `/query` endpoint works identically
- ✅ Response format unchanged (just adds `session_id` field)
- ✅ All existing integrations continue working
- ✅ No required configuration changes
- ✅ No data migration needed (nothing was stored before)

### What's New
- ✨ Conversations are now automatically stored
- ✨ Each response includes a `session_id`
- ✨ New endpoints for conversation management
- ✨ Automatic 30-day purge via cron
- ✨ Storage monitoring endpoints

## 🚀 Migration Steps

### Step 1: Update Code (Local Testing)

```bash
# Pull latest changes
git pull origin main

# Install dependencies (if needed)
npm install

# Start local dev server
npm run dev
```

### Step 2: Test Locally

```bash
# Run test suite
./test-purge.sh

# Expected output: All 13 tests pass ✓
```

### Step 3: Deploy to Staging (Recommended)

```bash
# Deploy to staging environment
npx wrangler deploy --env staging

# Test staging
BASE_URL=https://your-staging-worker.workers.dev ./test-purge.sh
```

### Step 4: Deploy to Production

```bash
# Deploy to production
npx wrangler deploy

# Verify deployment
curl https://your-worker.workers.dev/health

# Check storage stats
curl https://your-worker.workers.dev/storage-stats?accountId=default
```

### Step 5: Verify Cron Trigger

```bash
# Manually trigger cron for testing
npx wrangler triggers cron

# Monitor logs
npx wrangler tail

# Expected log: "[Cron] Starting scheduled purge job"
```

## 📊 Before vs After

### Before (Stateless)
```bash
# Request
curl -X POST http://localhost:8787/query \
  -d '{"query": "Hello"}'

# Response
{
  "success": true,
  "response": "Hi there!"
}
```

### After (With Storage)
```bash
# Request (same as before)
curl -X POST http://localhost:8787/query \
  -d '{"query": "Hello"}'

# Response (adds session_id)
{
  "success": true,
  "response": "Hi there!",
  "session_id": "session_1697500000000_abc123"
}
```

## 🔄 Gradual Rollout Strategy

### Option 1: Feature Flag (Recommended)

Add environment variable to control storage:

```toml
# wrangler.toml
[vars]
ENABLE_CONVERSATION_STORAGE = "true"
```

```typescript
// In server.ts (optional enhancement)
if (env.ENABLE_CONVERSATION_STORAGE === "true") {
  // Store conversation
}
```

### Option 2: Per-Account Rollout

Enable storage for specific accounts first:

```typescript
const enabledAccounts = ["test-user", "beta-user"];
if (enabledAccounts.includes(accountId)) {
  // Store conversation
}
```

### Option 3: All-at-Once (Current Implementation)

Storage is enabled for all accounts immediately (current implementation).

## 🧪 Testing Your Migration

### Test 1: Verify Existing Functionality
```bash
# Old-style request (no session_id)
curl -X POST https://your-worker.workers.dev/query \
  -H "Content-Type: application/json" \
  -d '{"query": "What is 2+2?", "accountId": "test"}'

# Should work and return session_id
```

### Test 2: Verify Storage
```bash
# Check storage stats
curl https://your-worker.workers.dev/storage-stats?accountId=test

# Should show total_conversations > 0
```

### Test 3: Verify Multi-Turn Conversations
```bash
# First message
response=$(curl -s -X POST https://your-worker.workers.dev/query \
  -H "Content-Type: application/json" \
  -d '{"query": "My name is Alice", "accountId": "test"}')

session_id=$(echo $response | jq -r '.session_id')

# Second message (same session)
curl -X POST https://your-worker.workers.dev/query \
  -H "Content-Type: application/json" \
  -d "{\"query\": \"What is my name?\", \"accountId\": \"test\", \"session_id\": \"$session_id\"}"
```

### Test 4: Verify Purge
```bash
# Manual purge trigger
curl -X POST https://your-worker.workers.dev/purge?accountId=test

# Should return: {"deleted": N, "errors": 0}
```

## 📈 Monitoring Post-Migration

### Key Metrics to Watch

1. **Storage Growth**
```bash
# Check daily
curl https://your-worker.workers.dev/storage-stats?accountId=default
```

2. **Purge Operations**
```bash
# Monitor logs
npx wrangler tail --format pretty

# Look for: "[Purge] Deleted N conversations"
```

3. **Error Rates**
```bash
# Check for storage errors
npx wrangler tail | grep "Storage Error"
```

4. **Response Times**
```bash
# Storage should add minimal latency (~5ms)
# Monitor your existing metrics
```

## 🔧 Configuration Changes

### wrangler.toml Changes

**Added:**
```toml
[triggers]
crons = ["0 2 * * *"]  # Daily purge at 2 AM UTC
```

**Existing (unchanged):**
```toml
[[migrations]]
tag = "v1"
new_sqlite_classes = ["AgentContainer"]
```

### No Changes Required For:
- Environment variables
- Secrets
- Bindings
- Container configuration
- Instance types

## 🐛 Troubleshooting Migration

### Issue: "Cannot find name 'SqlStorage'"
**Solution**: This is a TypeScript lint error - ignore it. Types are provided by Cloudflare Workers runtime.

### Issue: Cron not running after deployment
**Solution**: 
```bash
# Verify cron is configured
cat wrangler.toml | grep crons

# Manually trigger
npx wrangler triggers cron

# Check logs
npx wrangler tail
```

### Issue: Storage stats show 0 conversations
**Solution**: Create a conversation first:
```bash
curl -X POST https://your-worker.workers.dev/query \
  -H "Content-Type: application/json" \
  -d '{"query": "Test", "accountId": "default"}'
```

### Issue: Old conversations not being purged
**Solution**: 
- Purge only affects conversations older than 30 days
- Check `last_accessed_at` timestamp
- Manually trigger purge for testing: `POST /purge`

## 📊 Storage Impact

### Expected Storage Usage

| Conversations | Messages/Conv | Storage Size |
|--------------|---------------|--------------|
| 100 | 4 | ~1 MB |
| 1,000 | 4 | ~10 MB |
| 10,000 | 4 | ~100 MB |

### Cost Impact

**Durable Objects Storage**: $0.20/GB-month

With 30-day retention:
- 1,000 conversations/day = ~300 MB = **$0.06/month**
- 10,000 conversations/day = ~3 GB = **$0.60/month**

## ✅ Migration Checklist

- [ ] Review changes in `server.ts`
- [ ] Review changes in `wrangler.toml`
- [ ] Test locally with `npm run dev`
- [ ] Run test suite: `./test-purge.sh`
- [ ] Deploy to staging (if available)
- [ ] Test staging environment
- [ ] Deploy to production
- [ ] Verify cron trigger
- [ ] Monitor logs for 24 hours
- [ ] Check storage stats
- [ ] Verify purge runs successfully
- [ ] Update internal documentation
- [ ] Notify team of new features

## 🎯 Rollback Plan

If you need to rollback:

```bash
# 1. Revert to previous version
git revert <commit-hash>

# 2. Redeploy
npx wrangler deploy

# 3. Verify
curl https://your-worker.workers.dev/health
```

**Note**: Stored conversations will remain in Durable Objects but won't be accessed. They'll be purged after 30 days.

## 📞 Support

If you encounter issues:

1. Check logs: `npx wrangler tail`
2. Review documentation: `PURGE_IMPLEMENTATION.md`
3. Run test suite: `./test-purge.sh`
4. Check troubleshooting: `PURGE_IMPLEMENTATION.md#troubleshooting`

## 🎉 Success Criteria

Migration is successful when:

- ✅ All existing queries work
- ✅ New queries return `session_id`
- ✅ Storage stats endpoint returns data
- ✅ Cron trigger runs without errors
- ✅ Test suite passes
- ✅ No increase in error rates
- ✅ Response times remain acceptable

## 📚 Additional Resources

- **[PURGE_IMPLEMENTATION.md](./PURGE_IMPLEMENTATION.md)**: Full implementation details
- **[QUICK_REFERENCE.md](./QUICK_REFERENCE.md)**: Quick command reference
- **[IMPLEMENTATION_SUMMARY.md](./IMPLEMENTATION_SUMMARY.md)**: What was built
- **[README.md](./README.md)**: Updated main documentation
