import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { createServer } from "./server.js";
import { allTools } from "./tools/index.js";
import { loadKnowledge } from "./knowledge/load.js";
import { makeDocFetch } from "./docs/fetch.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const dataDir = join(root, "data");

let version = "0.0.0";
try { version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version ?? version; } catch { /* ignore */ }

const knowledge = loadKnowledge(dataDir);
const ctx = { knowledge, docFetch: makeDocFetch() };
const server = createServer(allTools, ctx, version);
await server.connect(new StdioServerTransport());
