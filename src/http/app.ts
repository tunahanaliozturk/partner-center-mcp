import { createServer as createHttpServer } from "node:http";
import type { IncomingMessage, Server } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "../server.js";
import { allTools } from "../tools/index.js";
import type { ToolContext } from "../types.js";

export interface HttpAppOptions {
  ctx: ToolContext;
  version: string;
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      try { resolve(raw ? JSON.parse(raw) : undefined); } catch { resolve(undefined); }
    });
    req.on("error", () => resolve(undefined));
  });
}

// Builds the HTTP server without starting it, so tests can bind an ephemeral port.
// Same tools, resources, and prompts as the stdio entry point, served statelessly
// over Streamable HTTP at POST /mcp.
export function createHttpApp({ ctx, version }: HttpAppOptions): Server {
  return createHttpServer(async (req, res) => {
    const path = (req.url ?? "").split("?")[0];
    if (path === "/healthz") { res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, version })); return; }
    if (path !== "/mcp") { res.writeHead(404, { "content-type": "text/plain" }).end("Not found"); return; }
    if (req.method !== "POST") { res.writeHead(405, { Allow: "POST" }).end("Method Not Allowed"); return; }

    try {
      const body = await readBody(req);
      // Stateless: a fresh server + transport per request.
      const server = createServer(allTools, ctx, version);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on("close", () => { void transport.close(); void server.close(); });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (err) {
      if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: String((err as Error)?.message ?? err) }));
    }
  });
}
