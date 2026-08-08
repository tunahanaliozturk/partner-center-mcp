import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { createHttpApp } from "./http/app.js";
import { loadKnowledge } from "./knowledge/load.js";
import { makeDocFetch } from "./docs/fetch.js";

// Remote/HTTP variant of the server. All request handling lives in ./http/app.ts;
// this file only wires up real dependencies and binds the port.
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

let version = "0.0.0";
try { version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version ?? version; } catch { /* ignore */ }

const ctx = { knowledge: loadKnowledge(join(root, "data")), docFetch: makeDocFetch() };
const port = Number(process.env.PORT ?? process.argv[2] ?? 3000);

// Loopback by default. The endpoint is unauthenticated, so binding every
// interface would put it on the LAN for anyone who runs it on a laptop. Set
// HOST=0.0.0.0 deliberately, behind your own auth, to expose it.
const host = process.env.HOST ?? "127.0.0.1";

// Extra browser origins allowed to reach /mcp, comma-separated. Loopback is
// always allowed and non-browser clients send no Origin at all.
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",").map((o) => o.trim()).filter(Boolean);

const maxBodyBytes = Number(process.env.MAX_BODY_BYTES) || undefined;

createHttpApp({ ctx, version, allowedOrigins, maxBodyBytes }).listen(port, host, () => {
  console.error(`partner-center-mcp HTTP server listening on http://${host}:${port}/mcp`);
  if (host !== "127.0.0.1" && host !== "localhost") {
    console.error(`warning: bound to ${host}; /mcp has no authentication, put it behind a proxy that does`);
  }
});
