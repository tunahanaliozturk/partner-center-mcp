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

createHttpApp({ ctx, version })
  .listen(port, () => console.error(`partner-center-mcp HTTP server listening on http://localhost:${port}/mcp`));
