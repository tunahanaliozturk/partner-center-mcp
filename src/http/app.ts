import { createServer as createHttpServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "../server.js";
import { allTools } from "../tools/index.js";
import type { ToolContext } from "../types.js";

export interface HttpAppOptions {
  ctx: ToolContext;
  version: string;
  /** Largest request body accepted, in bytes. Defaults to 1 MiB. */
  maxBodyBytes?: number;
  /**
   * Origins allowed to call /mcp from a browser, in addition to loopback.
   * Anything not on this list and not loopback is refused with 403.
   */
  allowedOrigins?: string[];
}

const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

class PayloadTooLarge extends Error {}

/**
 * Reads the body with a hard ceiling. Without one, a single unauthenticated POST
 * can pin the process's memory: the old implementation concatenated chunks until
 * the client stopped sending.
 */
function readBody(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c) => {
      const chunk = c as Buffer;
      size += chunk.length;
      if (size > maxBytes) {
        reject(new PayloadTooLarge());
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      try { resolve(raw ? JSON.parse(raw) : undefined); } catch { resolve(undefined); }
    });
    req.on("error", () => resolve(undefined));
  });
}

/**
 * A local MCP endpoint is reachable from any web page the user happens to have
 * open, so a browser can be used to drive it (DNS rebinding). Requests carrying
 * no Origin are non-browser clients and pass; a browser Origin has to be
 * loopback or explicitly allowed.
 */
function originAllowed(origin: string | undefined, allowed: string[]): boolean {
  if (origin === undefined || origin === "null") return true;
  if (allowed.includes(origin)) return true;
  try {
    const { hostname } = new URL(origin);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
  } catch {
    return false;
  }
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "content-type": "application/json", ...headers }).end(JSON.stringify(body));
}

// Builds the HTTP server without starting it, so tests can bind an ephemeral port.
// Same tools, resources, and prompts as the stdio entry point, served statelessly
// over Streamable HTTP at POST /mcp.
export function createHttpApp({ ctx, version, maxBodyBytes, allowedOrigins }: HttpAppOptions): Server {
  const limit = maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const allowed = allowedOrigins ?? [];

  return createHttpServer(async (req, res) => {
    const path = (req.url ?? "").split("?")[0];
    if (path === "/healthz") { send(res, 200, { ok: true, version }); return; }
    if (path !== "/mcp") { res.writeHead(404, { "content-type": "text/plain" }).end("Not found"); return; }
    if (req.method !== "POST") { res.writeHead(405, { Allow: "POST" }).end("Method Not Allowed"); return; }

    if (!originAllowed(req.headers.origin, allowed)) {
      send(res, 403, { error: "Origin not allowed" });
      return;
    }

    // Reject an oversized body on the declared length before reading a byte.
    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > limit) {
      send(res, 413, { error: "Payload too large" });
      return;
    }

    try {
      const body = await readBody(req, limit);
      // Stateless: a fresh server + transport per request.
      const server = createServer(allTools, ctx, version);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on("close", () => { void transport.close(); void server.close(); });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (err) {
      if (res.headersSent) return;
      if (err instanceof PayloadTooLarge) { send(res, 413, { error: "Payload too large" }); return; }
      // The message can carry a filesystem path or an internal detail, so it is
      // logged rather than returned.
      console.error("partner-center-mcp: request failed", err);
      send(res, 500, { error: "Internal error" });
    }
  });
}
