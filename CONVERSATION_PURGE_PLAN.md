# Conversation Purge Implementation Plan

## Executive Summary

This document outlines the plan to implement automatic conversation purging with a 30-day retention window for the Claude Agent SDK running on Cloudflare Durable Objects. This will prevent Durable Objects from growing indefinitely by cleaning up old conversation data.

---

## Current State Analysis

### Architecture Overview

**Main Components:**
- **`server.ts`**: Cloudflare Worker that routes requests to Durable Objects
- **`container/server.js`**: Node.js server inside Docker container running Claude Agent SDK  
- **`AgentContainer`**: Durable Object class that manages containerized instances
- **Storage**: SQLite-backed Durable Objects (configured in `wrangler.toml`)

**Current Flow:**
```
Client Request → Worker (server.ts) → Durable Object (per accountId) → Container (server.js) → Claude SDK
```

### Key Findings

1. **Stateless Queries**: Currently, each query to the Claude SDK is stateless - no conversation history is persisted
2. **No Storage Usage**: The codebase doesn't currently use Durable Object storage for conversation data
3. **Session Support**: Claude Agent SDK supports session management with `session_id` for multi-turn conversations
4. **SQLite Available**: Durable Objects are configured with SQLite storage (`new_sqlite_classes` in wrangler.toml)
5. **Isolation by Account**: Each `accountId` gets its own Durable Object instance

**Critical Gap**: Before implementing purging, we need to implement conversation persistence first, as there's currently nothing being stored.

---

## Problem Statement

Without conversation purging:
- Durable Objects would accumulate conversation data indefinitely
- Storage costs would grow unbounded
- Durable Object performance could degrade with large datasets
- No compliance with data retention policies

**Goal**: Implement a system that:
1. Stores conversation history for continuity
2. Automatically purges conversations older than 30 days
3. Runs efficiently without impacting request latency
4. Provides visibility into storage usage

---

## Implementation Approach

### Phase 1: Conversation Storage (Prerequisite)

**Add conversation persistence to enable multi-turn conversations and provide data to purge.**

#### 1.1 Database Schema Design

```sql
-- Conversations table
CREATE TABLE IF NOT EXISTS conversations (
  session_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,  -- Unix timestamp (ms)
  last_accessed_at INTEGER NOT NULL,  -- Unix timestamp (ms)
  metadata TEXT  -- JSON: {prompt_count, model, etc.}
);

-- Messages table (for conversation history)
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,  -- Unix timestamp (ms)
  role TEXT NOT NULL,  -- 'user' | 'assistant' | 'system'
  content TEXT NOT NULL,  -- JSON serialized content
  FOREIGN KEY (session_id) REFERENCES conversations(session_id) ON DELETE CASCADE
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_conversations_last_accessed 
  ON conversations(last_accessed_at);
CREATE INDEX IF NOT EXISTS idx_conversations_account 
  ON conversations(account_id);
CREATE INDEX IF NOT EXISTS idx_messages_session 
  ON messages(session_id, timestamp);
```

#### 1.2 Modify `AgentContainer` Class

**Add storage initialization in constructor:**
```typescript
export class AgentContainer extends Container {
  defaultPort = 8080;
  sleepAfter = "20m";
  private sql: SqlStorage;  // SQLite storage instance

  constructor(ctx: DurableObjectState, env: any) {
    super(ctx, env);
    this.sql = ctx.storage.sql;  // Access SQLite storage
    this.envVars = {
      CLAUDE_CODE_OAUTH_TOKEN: env.CLAUDE_CODE_OAUTH_TOKEN || "",
    };
    
    // Initialize database schema on first access
    this.initializeDatabase();
  }

  private initializeDatabase() {
    // Run schema creation (idempotent)
    this.sql.exec(`CREATE TABLE IF NOT EXISTS conversations ...`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS messages ...`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS ...`);
  }
}
```

#### 1.3 Add API Endpoints

**New endpoints to add to `server.ts`:**

1. **`POST /query`** (modify existing)
   - Accept optional `session_id` for resuming conversations
   - Return `session_id` in response for tracking
   - Store conversation metadata and messages

2. **`GET /conversations`** (new)
   - List conversations for an account
   - Support pagination and filtering

3. **`DELETE /conversations/:session_id`** (new)
   - Manually delete a specific conversation

4. **`GET /storage-stats`** (new)
   - View storage usage statistics
   - Show conversation count, oldest conversation, storage size

---

### Phase 2: Automatic Purge Implementation

#### 2.1 Purge Strategy Options

**Option A: On-Request Purge (Recommended for MVP)**
- Trigger purge check on every request or periodically
- Low complexity, no additional infrastructure
- Slight latency impact on requests that trigger purge

**Option B: Scheduled Purge via Cron Triggers**
- Use Cloudflare Cron Triggers to run purge jobs
- Requires additional endpoint and configuration
- Zero impact on user requests
- Better for production at scale

**Option C: Lazy Deletion**
- Mark conversations as "expired" without deleting
- Delete only when accessed
- Simplest implementation
- Storage still grows (not recommended)

**Recommended: Start with Option A, migrate to Option B for production**

#### 2.2 Purge Logic Implementation

**Add purge method to `AgentContainer`:**

```typescript
class AgentContainer extends Container {
  private readonly PURGE_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
  private lastPurgeCheck = 0;
  private readonly PURGE_CHECK_INTERVAL = 60 * 60 * 1000; // Check hourly

  async purgeOldConversations(): Promise<{ deleted: number, errors: number }> {
    const cutoffTime = Date.now() - this.PURGE_THRESHOLD_MS;
    
    try {
      // Find conversations to delete
      const toDelete = this.sql.exec(
        `SELECT session_id FROM conversations 
         WHERE last_accessed_at < ?`,
        cutoffTime
      );

      // Delete conversations (messages cascade automatically)
      const result = this.sql.exec(
        `DELETE FROM conversations WHERE last_accessed_at < ?`,
        cutoffTime
      );

      console.log(`[Purge] Deleted ${result.rowsWritten} conversations older than 30 days`);
      
      return { 
        deleted: result.rowsWritten || 0, 
        errors: 0 
      };
    } catch (error) {
      console.error('[Purge] Error during purge:', error);
      return { deleted: 0, errors: 1 };
    }
  }

  async shouldRunPurge(): Promise<boolean> {
    const now = Date.now();
    if (now - this.lastPurgeCheck < this.PURGE_CHECK_INTERVAL) {
      return false;
    }
    this.lastPurgeCheck = now;
    return true;
  }
}
```

**Integrate into request handling:**

```typescript
app.post("/query", async (c) => {
  try {
    const id = c.env.AGENT_CONTAINER.idFromName(accountId);
    const instance = c.env.AGENT_CONTAINER.get(id);
    
    // Trigger purge check (async, don't block request)
    // This runs in background without blocking the response
    instance.fetch(new Request("http://internal/purge-check", { 
      method: "POST" 
    })).catch(err => console.error('[Purge Check Failed]', err));
    
    // Continue with normal query processing...
  }
});
```

#### 2.3 Cron-Based Purge (Production Enhancement)

**Add to `wrangler.toml`:**
```toml
[triggers]
crons = ["0 2 * * *"]  # Run daily at 2 AM UTC
```

**Add scheduled handler in `server.ts`:**
```typescript
export default {
  async scheduled(event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) {
    // Iterate through all active Durable Objects and trigger purge
    // This requires maintaining a list of active accountIds
    // Or use a separate "purge coordinator" Durable Object
  }
};
```

---

### Phase 3: Monitoring & Observability

#### 3.1 Storage Metrics Endpoint

```typescript
app.get("/storage-stats", async (c) => {
  const accountId = c.req.query("accountId") || "default";
  const id = c.env.AGENT_CONTAINER.idFromName(accountId);
  const instance = c.env.AGENT_CONTAINER.get(id);
  
  const stats = await instance.fetch(
    new Request("http://internal/stats", { method: "GET" })
  );
  
  return c.json(await stats.json());
});

// In AgentContainer:
async getStorageStats() {
  const totalConversations = this.sql.exec(
    `SELECT COUNT(*) as count FROM conversations`
  ).toArray()[0].count;
  
  const oldestConversation = this.sql.exec(
    `SELECT MIN(created_at) as oldest FROM conversations`
  ).toArray()[0].oldest;
  
  const conversationsToExpire = this.sql.exec(
    `SELECT COUNT(*) as count FROM conversations 
     WHERE last_accessed_at < ?`,
    Date.now() - this.PURGE_THRESHOLD_MS
  ).toArray()[0].count;
  
  return {
    total_conversations: totalConversations,
    oldest_conversation_age_days: oldestConversation 
      ? (Date.now() - oldestConversation) / (24 * 60 * 60 * 1000) 
      : null,
    conversations_ready_to_purge: conversationsToExpire,
    retention_policy_days: 30
  };
}
```

#### 3.2 Logging Strategy

```typescript
// Add structured logging for purge operations
interface PurgeLog {
  timestamp: number;
  account_id: string;
  deleted_count: number;
  duration_ms: number;
  oldest_deleted: number;
}

// Log to Cloudflare Analytics or external service
console.log(JSON.stringify({
  event: 'purge_completed',
  ...purgeLog
}));
```

---

## Configuration & Tuning

### Configurable Parameters

```typescript
// Add to environment variables or configuration
interface PurgeConfig {
  RETENTION_DAYS: number;           // Default: 30
  PURGE_CHECK_INTERVAL_HOURS: number; // Default: 1
  PURGE_BATCH_SIZE: number;          // Default: 1000 (if batch deletion needed)
  ENABLE_AUTO_PURGE: boolean;        // Default: true
}
```

### Performance Considerations

1. **Index Optimization**: `last_accessed_at` index ensures fast purge queries
2. **Batch Deletion**: For very large datasets, delete in batches to avoid timeouts
3. **Async Purge**: Run purge in background to avoid blocking user requests
4. **Rate Limiting**: Limit purge frequency to once per hour per Durable Object

---

## Migration & Rollout

### Step 1: Schema Migration
- Deploy schema creation code
- Existing Durable Objects will auto-create tables on first access
- No data loss (nothing currently stored)

### Step 2: Enable Storage (Feature Flag)
- Add feature flag `ENABLE_CONVERSATION_STORAGE`
- Gradually roll out to test accounts
- Monitor storage usage and performance

### Step 3: Enable Purge (Feature Flag)
- Add feature flag `ENABLE_AUTO_PURGE`
- Test on non-production environments first
- Monitor purge logs and storage metrics

### Step 4: Production Rollout
- Enable for all accounts
- Set up monitoring alerts
- Document behavior for users

---

## Testing Strategy

### Unit Tests
```typescript
// Test purge logic
test('purgeOldConversations deletes only old conversations', async () => {
  // Create conversations with different timestamps
  // Run purge
  // Verify only old ones deleted
});

test('purge respects 30-day threshold', async () => {
  // Create conversation at exactly 30 days + 1 second
  // Run purge
  // Verify it's deleted
});
```

### Integration Tests
```bash
# Create conversation
curl -X POST http://localhost:8787/query \
  -d '{"query": "test", "accountId": "test-user"}'

# Check storage stats
curl http://localhost:8787/storage-stats?accountId=test-user

# Wait or mock time
# Trigger purge
# Verify conversation deleted
```

### Load Testing
- Test purge performance with 10k+ conversations
- Measure latency impact on user requests
- Verify memory usage stays bounded

---

## Alternative Approaches Considered

### 1. External Database (e.g., D1 or R2)
**Pros:**
- Centralized storage across all Durable Objects
- Easier to query across accounts
- Single purge job for all data

**Cons:**
- Added latency for storage operations
- More complex architecture
- Additional costs
- Loses Durable Object isolation benefits

**Verdict**: Not recommended. Durable Object SQLite is ideal for this use case.

### 2. Time-to-Live (TTL) in Storage
**Pros:**
- Automatic cleanup without custom logic

**Cons:**
- Cloudflare Durable Objects don't support TTL natively
- Would need to implement custom TTL logic anyway

**Verdict**: Not available as a feature.

### 3. Conversation Archival to R2
**Pros:**
- Keep historical data for analytics
- Reduce Durable Object storage costs

**Cons:**
- More complexity
- Additional costs for R2 storage

**Verdict**: Could be added as Phase 4 for compliance/analytics needs.

---

## Cost Analysis

### Storage Costs
- Durable Objects: $0.20/GB-month
- Typical conversation: ~10KB (1000 conversations = 10MB)
- With 30-day retention: Storage stays bounded

### Compute Costs
- Purge operation: ~10ms per 1000 conversations
- Minimal impact on overall compute costs
- Running once per hour: negligible overhead

---

## Security Considerations

1. **Data Isolation**: Each accountId has separate Durable Object (already implemented)
2. **Purge Verification**: Log what's deleted for audit trail
3. **Manual Override**: Admin endpoint to disable auto-purge if needed
4. **Compliance**: 30-day retention aligns with common data retention policies

---

## Success Metrics

1. **Storage Bounded**: Maximum storage per Durable Object stays under threshold
2. **Zero Data Loss**: No active conversations (< 30 days) deleted
3. **Low Latency**: Purge operations don't impact p95 response times
4. **Visibility**: Storage stats endpoint shows accurate data

---

## Timeline Estimate

- **Phase 1 (Conversation Storage)**: 2-3 days
  - Schema design: 0.5 day
  - Storage implementation: 1 day
  - API endpoints: 0.5 day
  - Testing: 1 day

- **Phase 2 (Purge Implementation)**: 1-2 days
  - Purge logic: 0.5 day
  - Integration: 0.5 day
  - Testing: 1 day

- **Phase 3 (Monitoring)**: 1 day
  - Stats endpoint: 0.5 day
  - Logging: 0.5 day

**Total Estimate**: 4-6 days

---

## Next Steps

1. ✅ Review and approve this plan
2. ⬜ Implement Phase 1: Conversation Storage
3. ⬜ Implement Phase 2: Purge Logic
4. ⬜ Implement Phase 3: Monitoring
5. ⬜ Write tests
6. ⬜ Deploy to staging
7. ⬜ Production rollout with feature flags

---

## Open Questions

1. **Retention Period**: Is 30 days the right default? Should it be configurable per account?
2. **Purge Frequency**: Is hourly purge checks sufficient? Or daily?
3. **User Notification**: Should users be notified before conversations are purged?
4. **Export Feature**: Should users be able to export conversation history before purge?
5. **Soft Delete**: Should we soft-delete first (grace period) before hard delete?

---

## References

- [Cloudflare Durable Objects Storage API](https://developers.cloudflare.com/durable-objects/api/storage-api/)
- [Cloudflare SQLite Storage](https://blog.cloudflare.com/sqlite-in-durable-objects/)
- [Claude Agent SDK Session Management](https://docs.claude.com/en/api/agent-sdk/sessions)
- Current codebase: `server.ts`, `container/server.js`, `wrangler.toml`
