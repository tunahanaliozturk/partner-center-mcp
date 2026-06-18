import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createServer } from "./server.js";
import { allTools } from "./tools/index.js";
import { loadKnowledge } from "./knowledge/load.js";
import { makeDocFetch } from "./docs/fetch.js";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, "..", "data");

const knowledge = loadKnowledge(dataDir);
const ctx = { knowledge, docFetch: makeDocFetch() };
const server = createServer(allTools, ctx);
await server.connect(new StdioServerTransport());
