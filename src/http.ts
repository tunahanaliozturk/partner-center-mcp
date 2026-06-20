import { createServer as createHttpServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "./server.js";
import { allTools } from "./tools/index.js";
import { loadKnowledge } from "./knowledge/load.js";
import { makeDocFetch } from "./docs/fetch.js";

// Remote/HTTP variant of the server: same tools, resources, and prompts as the
// stdio entry point, served statelessly over Streamable HTTP at POST /mcp.
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

let version = "0.0.0";
try { version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version ?? version; } catch { /* ignore */ }

const knowledge = loadKnowledge(join(root, "data"));
const docFetch = makeDocFetch();
const port = Number(process.env.PORT ?? process.argv[2] ?? 3000);

function readBody(req: import("node:http").IncomingMessage): Promise<unknown> {
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

const http = createHttpServer(async (req, res) => {
  const path = (req.url ?? "").split("?")[0];
  if (path === "/healthz") { res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, version })); return; }
  if (path !== "/mcp") { res.writeHead(404, { "content-type": "text/plain" }).end("Not found"); return; }
  if (req.method !== "POST") { res.writeHead(405, { Allow: "POST" }).end("Method Not Allowed"); return; }

  try {
    const body = await readBody(req);
    // Stateless: a fresh server + transport per request.
    const server = createServer(allTools, { knowledge, docFetch }, version);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => { void transport.close(); void server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  } catch (err) {
    if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: String((err as Error)?.message ?? err) }));
  }
});

http.listen(port, () => console.error(`partner-center-mcp HTTP server listening on http://localhost:${port}/mcp`));
