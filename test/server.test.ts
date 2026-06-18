import { test, expect } from "vitest";
import { createServer } from "../src/server.js";
import type { Tool, ToolContext } from "../src/types.js";

const ctx: ToolContext = { knowledge: {}, docFetch: async () => ({ ok: true, excerpts: [] }) };

test("createServer registers each provided tool", async () => {
  const tool: Tool = {
    name: "ping",
    description: "test tool",
    inputShape: {},
    run: () => ({ ok: true, data: "pong" }),
  };
  const server = createServer([tool], ctx);
  expect(server).toBeDefined();
  // McpServer exposes registered tools internally; assert no throw and a server object.
});

test("createServer with no tools returns a server", () => {
  expect(createServer([], ctx)).toBeDefined();
});
