import { Hono } from "hono";
import { Container } from "@cloudflare/containers";

export class AgentContainer extends Container {
  defaultPort = 8080;
  sleepAfter = "20m";
  private sql: SqlStorage;
  private readonly PURGE_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

  constructor(ctx: DurableObjectState, env: any) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.envVars = {
      CLAUDE_CODE_OAUTH_TOKEN: env.CLAUDE_CODE_OAUTH_TOKEN || "",
    };
    this.initializeDatabase();
  }

  private initializeDatabase() {
    // Enable foreign key enforcement
    this.sql.exec(`PRAGMA foreign_keys = ON`);
    // Create conversations table
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        session_id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_accessed_at INTEGER NOT NULL,
        metadata TEXT
      )
    `);

    // Create messages table
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES conversations(session_id) ON DELETE CASCADE
      )
    `);

    // Create indexes
    this.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_conversations_last_accessed 
      ON conversations(last_accessed_at)
    `);
    this.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_conversations_account 
      ON conversations(account_id)
    `);
    this.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_messages_session 
      ON messages(session_id, timestamp)
    `);
  }

  async purgeOldConversations(): Promise<{ deleted: number; errors: number }> {
    const cutoffTime = Date.now() - this.PURGE_THRESHOLD_MS;
    
    try {
      // Find conversations to delete for logging
      const toDelete = this.sql.exec(
        `SELECT session_id FROM conversations WHERE last_accessed_at < ?`,
        cutoffTime
      ).toArray();

      // Delete conversations (messages cascade automatically)
      const result = this.sql.exec(
        `DELETE FROM conversations WHERE last_accessed_at < ?`,
        cutoffTime
      );

      const deletedCount = toDelete.length;
      console.log(`[Purge] Deleted ${deletedCount} conversations older than 30 days`);
      
      return { 
        deleted: deletedCount, 
        errors: 0 
      };
    } catch (error) {
      console.error('[Purge] Error during purge:', error);
      return { deleted: 0, errors: 1 };
    }
  }

  async getStorageStats() {
    try {
      const totalConversations = this.sql.exec(
        `SELECT COUNT(*) as count FROM conversations`
      ).toArray()[0]?.count || 0;
      
      const oldestConversation = this.sql.exec(
        `SELECT MIN(created_at) as oldest FROM conversations`
      ).toArray()[0]?.oldest;
      
      const conversationsToExpire = this.sql.exec(
        `SELECT COUNT(*) as count FROM conversations WHERE last_accessed_at < ?`,
        Date.now() - this.PURGE_THRESHOLD_MS
      ).toArray()[0]?.count || 0;
      
      return {
        total_conversations: totalConversations,
        oldest_conversation_age_days: oldestConversation 
          ? (Date.now() - oldestConversation) / (24 * 60 * 60 * 1000) 
          : null,
        conversations_ready_to_purge: conversationsToExpire,
        retention_policy_days: 30
      };
    } catch (error) {
      console.error('[Stats] Error getting storage stats:', error);
      return {
        total_conversations: 0,
        oldest_conversation_age_days: null,
        conversations_ready_to_purge: 0,
        retention_policy_days: 30,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  async storeConversation(sessionId: string, accountId: string, messages: any[]) {
    const now = Date.now();
    
    try {
      // Upsert conversation
      this.sql.exec(
        `INSERT INTO conversations (session_id, account_id, created_at, last_accessed_at, metadata)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET last_accessed_at = ?`,
        sessionId, accountId, now, now, JSON.stringify({ message_count: messages.length }), now
      );

      // Store messages
      for (const msg of messages) {
        this.sql.exec(
          `INSERT INTO messages (session_id, timestamp, role, content) VALUES (?, ?, ?, ?)`,
          sessionId, now, msg.role, JSON.stringify(msg.content)
        );
      }
    } catch (error) {
      console.error('[Storage] Error storing conversation:', error);
      throw error;
    }
  }

  async getConversation(sessionId: string) {
    try {
      const conversation = this.sql.exec(
        `SELECT * FROM conversations WHERE session_id = ?`,
        sessionId
      ).toArray()[0];

      if (!conversation) {
        return null;
      }

      const messages = this.sql.exec(
        `SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp ASC`,
        sessionId
      ).toArray();

      const now = Date.now();
      this.sql.exec(
        `UPDATE conversations SET last_accessed_at = ? WHERE session_id = ?`,
        now, sessionId
      );

      return {
        ...conversation,
        last_accessed_at: now,
        metadata: conversation.metadata ? JSON.parse(conversation.metadata as string) : {},
        messages: messages.map(m => ({
          role: m.role,
          content: JSON.parse(m.content as string),
          timestamp: m.timestamp
        }))
      };
    } catch (error) {
      console.error('[Storage] Error getting conversation:', error);
      return null;
    }
  }

  async listConversations(accountId: string, limit = 50, offset = 0) {
    try {
      const conversations = this.sql.exec(
        `SELECT session_id, created_at, last_accessed_at, metadata 
         FROM conversations 
         WHERE account_id = ? 
         ORDER BY last_accessed_at DESC 
         LIMIT ? OFFSET ?`,
        accountId, limit, offset
      ).toArray();

      return conversations.map(c => ({
        session_id: c.session_id,
        created_at: c.created_at,
        last_accessed_at: c.last_accessed_at,
        metadata: c.metadata ? JSON.parse(c.metadata as string) : {}
      }));
    } catch (error) {
      console.error('[Storage] Error listing conversations:', error);
      return [];
    }
  }

  async deleteConversation(sessionId: string) {
    try {
      this.sql.exec(
        `DELETE FROM conversations WHERE session_id = ?`,
        sessionId
      );
      return true;
    } catch (error) {
      console.error('[Storage] Error deleting conversation:', error);
      return false;
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    
    // Handle internal storage operations
    if (url.pathname === "/purge" && request.method === "POST") {
      const result = await this.purgeOldConversations();
      return new Response(JSON.stringify(result), {
        headers: { "content-type": "application/json" }
      });
    }
    
    if (url.pathname === "/stats" && request.method === "GET") {
      const stats = await this.getStorageStats();
      return new Response(JSON.stringify(stats), {
        headers: { "content-type": "application/json" }
      });
    }
    
    if (url.pathname === "/conversations" && request.method === "GET") {
      const limit = parseInt(url.searchParams.get("limit") || "50");
      const offset = parseInt(url.searchParams.get("offset") || "0");
      const accountId = url.searchParams.get("accountId") || "default";
      const conversations = await this.listConversations(accountId, limit, offset);
      return new Response(JSON.stringify(conversations), {
        headers: { "content-type": "application/json" }
      });
    }
    
    if (url.pathname.startsWith("/conversation/") && request.method === "GET") {
      const sessionId = url.pathname.split("/conversation/")[1];
      const conversation = await this.getConversation(sessionId);
      return new Response(JSON.stringify(conversation || { error: "Not found" }), {
        status: conversation ? 200 : 404,
        headers: { "content-type": "application/json" }
      });
    }
    
    if (url.pathname.startsWith("/conversation/") && request.method === "DELETE") {
      const sessionId = url.pathname.split("/conversation/")[1];
      const success = await this.deleteConversation(sessionId);
      return new Response(JSON.stringify({ success }), {
        headers: { "content-type": "application/json" }
      });
    }
    
    if (url.pathname === "/store-conversation" && request.method === "POST") {
      const body = await request.json();
      await this.storeConversation(body.session_id, body.account_id, body.messages);
      return new Response(JSON.stringify({ success: true }), {
        headers: { "content-type": "application/json" }
      });
    }
    
    // Delegate to parent Container class for container operations
    return super.fetch(request);
  }
}

type Bindings = {
  AGENT_CONTAINER: DurableObjectNamespace<AgentContainer>;
  CLAUDE_CODE_OAUTH_TOKEN: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.get("/health", (c) => {
  return c.json({
    status: "healthy",
    hasToken: !!c.env?.CLAUDE_CODE_OAUTH_TOKEN,
    hasContainer: !!c.env?.AGENT_CONTAINER,
    timestamp: new Date().toISOString(),
  });
});

app.post("/query", async (c) => {
  try {
    if (!c.env.CLAUDE_CODE_OAUTH_TOKEN) {
      return c.json({ error: "CLAUDE_CODE_OAUTH_TOKEN not set" }, 500);
    }

    const body = await c.req.json().catch(() => ({}));
    const prompt = body.query || body.prompt;
    const accountId = body.accountId || "default";
    const sessionId = body.session_id || `session_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

    if (!prompt) {
      return c.json({ error: "No prompt provided" }, 400);
    }

    const id = c.env.AGENT_CONTAINER.idFromName(accountId);
    const instance = c.env.AGENT_CONTAINER.get(id);

    await instance.startAndWaitForPorts({
      ports: [8080],
      startOptions: {
        envVars: {
          CLAUDE_CODE_OAUTH_TOKEN: c.env.CLAUDE_CODE_OAUTH_TOKEN,
        },
      },
    });

    const containerRes = await instance.fetch(
      new Request("http://container.internal/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt, session_id: sessionId })
      })
    );

    const result = await containerRes.json();

    // Store conversation
    try {
      const storeRes = await instance.fetch(
        new Request("http://container.internal/store-conversation", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ 
            session_id: sessionId, 
            account_id: accountId,
            messages: [
              { role: "user", content: prompt },
              { role: "assistant", content: result.response }
            ]
          })
        })
      );
    } catch (storeError) {
      console.error("[Storage Error]", storeError);
      // Don't fail the request if storage fails
    }

    return c.json({ ...result, session_id: sessionId });
  } catch (error: any) {
    console.error("[Query Error]", error);
    return c.json({ error: error.message }, 500);
  }
});

// Get storage stats for an account
app.get("/storage-stats", async (c) => {
  try {
    const accountId = c.req.query("accountId") || "default";
    const id = c.env.AGENT_CONTAINER.idFromName(accountId);
    const instance = c.env.AGENT_CONTAINER.get(id);

    const statsRes = await instance.fetch(
      new Request("http://container.internal/stats", { method: "GET" })
    );

    return c.json(await statsRes.json());
  } catch (error: any) {
    console.error("[Stats Error]", error);
    return c.json({ error: error.message }, 500);
  }
});

// List conversations for an account
app.get("/conversations", async (c) => {
  try {
    const accountId = c.req.query("accountId") || "default";
    const limit = parseInt(c.req.query("limit") || "50");
    const offset = parseInt(c.req.query("offset") || "0");

    const id = c.env.AGENT_CONTAINER.idFromName(accountId);
    const instance = c.env.AGENT_CONTAINER.get(id);

    const listRes = await instance.fetch(
      new Request(`http://container.internal/conversations?limit=${limit}&offset=${offset}&accountId=${encodeURIComponent(accountId)}`, { 
        method: "GET" 
      })
    );

    return c.json(await listRes.json());
  } catch (error: any) {
    console.error("[List Error]", error);
    return c.json({ error: error.message }, 500);
  }
});

// Get a specific conversation
app.get("/conversations/:sessionId", async (c) => {
  try {
    const accountId = c.req.query("accountId") || "default";
    const sessionId = c.req.param("sessionId");

    const id = c.env.AGENT_CONTAINER.idFromName(accountId);
    const instance = c.env.AGENT_CONTAINER.get(id);

    const convRes = await instance.fetch(
      new Request(`http://container.internal/conversation/${sessionId}`, { 
        method: "GET" 
      })
    );

    return c.json(await convRes.json());
  } catch (error: any) {
    console.error("[Get Conversation Error]", error);
    return c.json({ error: error.message }, 500);
  }
});

// Delete a specific conversation
app.delete("/conversations/:sessionId", async (c) => {
  try {
    const accountId = c.req.query("accountId") || "default";
    const sessionId = c.req.param("sessionId");

    const id = c.env.AGENT_CONTAINER.idFromName(accountId);
    const instance = c.env.AGENT_CONTAINER.get(id);

    const deleteRes = await instance.fetch(
      new Request(`http://container.internal/conversation/${sessionId}`, { 
        method: "DELETE" 
      })
    );

    return c.json(await deleteRes.json());
  } catch (error: any) {
    console.error("[Delete Conversation Error]", error);
    return c.json({ error: error.message }, 500);
  }
});

// Manual purge trigger (for testing)
app.post("/purge", async (c) => {
  try {
    const accountId = c.req.query("accountId") || "default";
    const id = c.env.AGENT_CONTAINER.idFromName(accountId);
    const instance = c.env.AGENT_CONTAINER.get(id);

    const purgeRes = await instance.fetch(
      new Request("http://container.internal/purge", { method: "POST" })
    );

    return c.json(await purgeRes.json());
  } catch (error: any) {
    console.error("[Purge Error]", error);
    return c.json({ error: error.message }, 500);
  }
});

export default {
  fetch: app.fetch,
  
  // Scheduled handler for cron-based purge
  async scheduled(event: any, env: Bindings, ctx: any) {
    console.log("[Cron] Starting scheduled purge job");
    
    // Note: In a production system, you would maintain a list of active accountIds
    // For now, we'll document that purge happens per-account when they're accessed
    // A more sophisticated approach would be to maintain an index of all accounts
    
    // For demonstration, we'll purge a default account if it exists
    try {
      const id = env.AGENT_CONTAINER.idFromName("default");
      const instance = env.AGENT_CONTAINER.get(id);
      
      const purgeRes = await instance.fetch(
        new Request("http://container.internal/purge", { method: "POST" })
      );
      
      const result = await purgeRes.json();
      console.log("[Cron] Purge completed:", result);
    } catch (error) {
      console.error("[Cron] Purge failed:", error);
    }
  }
};
