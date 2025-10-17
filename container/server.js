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

      const { prompt, session_id } = JSON.parse(body || "{}");

      if (!prompt) {
        res.writeHead(400, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: "No prompt provided" }));
      }

      if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) {
        res.writeHead(500, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: "CLAUDE_CODE_OAUTH_TOKEN not set" }));
      }

      let responseText = "";
      const response = query({
        prompt,
        options: { model: "claude-sonnet-4-5" },
        session_id,
      });

      for await (const message of response) {
        if (message.type === "assistant" && message.message?.content) {
          for (const block of message.message.content) {
            if (block.type === "text") {
              responseText += block.text;
            }
          }
        }
      }

      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ success: true, response: responseText }));
    } catch (error) {
      console.error("[Container Error]", error.message);
      res.writeHead(500, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: error.message }));
    }
  }

  res.writeHead(404, { "content-type": "text/plain" });
  res.end("Not Found");
});

server.listen(PORT, () => {
  console.log(`Claude Agent SDK container listening on port ${PORT}`);
  console.log(`Token configured: ${!!process.env.CLAUDE_CODE_OAUTH_TOKEN}`);
});
