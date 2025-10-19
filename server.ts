import { Hono } from "hono";
import { Container } from "@cloudflare/containers";

export class AgentContainer extends Container {
  defaultPort = 8080;
  sleepAfter = "5m";

  constructor(ctx: DurableObjectState, env: any) {
    super(ctx, env);
    this.envVars = {
      ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY || env.CLAUDE_CODE_OAUTH_TOKEN || "",
      MODEL: env.MODEL || "claude-sonnet-4-5",
    };
  }

  override onStart() {
    console.log("[Container] Started", {
      timestamp: new Date().toISOString(),
      port: this.defaultPort,
      sleepAfter: this.sleepAfter
    });
  }

  override onStop(status: any) {
    console.log("[Container] Stopped", {
      reason: status?.reason,
      exitCode: status?.exitCode,
      timestamp: new Date().toISOString()
    });
  }

  override onError(error: unknown) {
    console.error("[Container] Error", {
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString()
    });
  }
}

type Bindings = {
  AGENT_CONTAINER: DurableObjectNamespace<AgentContainer>;
  ANTHROPIC_API_KEY?: string;
  CLAUDE_CODE_OAUTH_TOKEN?: string;
  MODEL?: string;
  API_KEY: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.get("/health", (c) => {
  return c.json({
    status: "healthy",
    hasApiKey: !!(c.env?.ANTHROPIC_API_KEY || c.env?.CLAUDE_CODE_OAUTH_TOKEN),
    hasContainer: !!c.env?.AGENT_CONTAINER,
    timestamp: new Date().toISOString(),
  });
});

app.post("/query", async (c) => {
  try {
    const authHeader = c.req.header("Authorization");
    const expectedToken = c.env.API_KEY;

    if (!authHeader || authHeader !== `Bearer ${expectedToken}`) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    if (!c.env.ANTHROPIC_API_KEY && !c.env.CLAUDE_CODE_OAUTH_TOKEN) {
      return c.json({ error: "ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN must be set" }, 500);
    }

    const body = await c.req.json().catch(() => ({}));
    const prompt = body.query || body.prompt;
    const accountId = body.accountId || "default";

    if (!prompt) {
      return c.json({ error: "No prompt provided" }, 400);
    }

    const id = c.env.AGENT_CONTAINER.idFromName(accountId);
    const instance = c.env.AGENT_CONTAINER.get(id);

    await instance.startAndWaitForPorts({
      ports: [8080],
      startOptions: {
        envVars: {
          ANTHROPIC_API_KEY: c.env.ANTHROPIC_API_KEY || c.env.CLAUDE_CODE_OAUTH_TOKEN || "",
          MODEL: c.env.MODEL || "claude-sonnet-4-5",
        },
      },
    });

    const containerRes = await instance.fetch(
      new Request("http://container.internal/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt })
      })
    );

    return c.newResponse(containerRes.body, containerRes);
  } catch (error: any) {
    console.error("[Query Error]", error);
    return c.json({ error: error.message }, 500);
  }
});

export default app;
