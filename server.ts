import { Hono } from "hono";
import { Container } from "@cloudflare/containers";

export class AgentContainer extends Container {
  defaultPort = 8080;
  sleepAfter = "20m";

  constructor(ctx: DurableObjectState, env: any) {
    super(ctx, env);
    this.envVars = {
      CLAUDE_CODE_OAUTH_TOKEN: env.CLAUDE_CODE_OAUTH_TOKEN || "",
      MODEL: env.MODEL || "claude-sonnet-4-5",
    };
  }
}

type Bindings = {
  AGENT_CONTAINER: DurableObjectNamespace<AgentContainer>;
  CLAUDE_CODE_OAUTH_TOKEN: string;
  MODEL?: string;
  API_KEY: string;
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
    const authHeader = c.req.header("Authorization");
    const expectedToken = c.env.API_KEY;

    if (!authHeader || authHeader !== `Bearer ${expectedToken}`) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    if (!c.env.CLAUDE_CODE_OAUTH_TOKEN) {
      return c.json({ error: "CLAUDE_CODE_OAUTH_TOKEN not set" }, 500);
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
          CLAUDE_CODE_OAUTH_TOKEN: c.env.CLAUDE_CODE_OAUTH_TOKEN,
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
