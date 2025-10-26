import { query } from "@anthropic-ai/claude-agent-sdk";
import http from "node:http";

const PORT = 8080;

const server = http.createServer(async (req, res) => {
  if (req.url === "/healthz" && req.method === "GET") {
    res.writeHead(200, { "content-type": "text/plain" });
    return res.end("ok");
  }

  if (req.url === "/run" && req.method === "POST") {
    let body = "";
    try {
      for await (const chunk of req) {
        body += chunk;
      }

      const { prompt } = JSON.parse(body || "{}") as { prompt?: string };

      if (!prompt) {
        res.writeHead(400, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: "No prompt provided" }));
      }

      if (!process.env.ANTHROPIC_API_KEY) {
        res.writeHead(500, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: "ANTHROPIC_API_KEY not set" }));
      }

      let responseText = "";
      const response = query({
        prompt,
        options: {
          model: process.env.MODEL || "claude-sonnet-4-5",
          settingSources: ['local', 'project'],
          permissionMode: 'bypassPermissions'
        },
      });

      for await (const message of response) {
        if (message.type === "assistant" && message.message?.content) {
          for (const block of message.message.content) {
            if (block.type === "text") {
              responseText += block.text;
            }

            // Log skill invocations
            if (block.type === "tool_use" && block.name === "Skill") {
              const skillCommand = block.input?.command || "unknown";
              console.log(`[Skill] Invoking skill: ${skillCommand}`);
            }
          }
        }
      }

      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ success: true, response: responseText }));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error("[Container Error]", errorMessage);
      res.writeHead(500, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: errorMessage }));
    }
  }

  res.writeHead(404, { "content-type": "text/plain" });
  res.end("Not Found");
});

server.listen(PORT, () => {
  console.log(`Claude Agent SDK container listening on port ${PORT}`);
  console.log(`API key configured: ${!!process.env.ANTHROPIC_API_KEY}`);
});
