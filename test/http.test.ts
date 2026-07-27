import { test, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createHttpApp } from "../src/http/app.js";
import type { Knowledge, ToolContext } from "../src/types.js";

const ctx: ToolContext = {
  knowledge: {} as Knowledge,
  docFetch: async () => ({ ok: true, excerpts: [] }),
};

let server: Server;
let base: string;

beforeAll(async () => {
  server = createHttpApp({ ctx, version: "9.9.9" });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function rpc(body: unknown): Promise<Response> {
  return fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(body),
  });
}

test("GET /healthz reports ok and the version", async () => {
  const res = await fetch(`${base}/healthz`);
  expect(res.status).toBe(200);
  await expect(res.json()).resolves.toEqual({ ok: true, version: "9.9.9" });
});

test("POST /mcp initialize returns the server identity", async () => {
  const res = await rpc({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "vitest", version: "1" },
    },
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { result?: { serverInfo?: { name?: string; version?: string } } };
  expect(body.result?.serverInfo?.name).toBe("partner-center-mcp");
  expect(body.result?.serverInfo?.version).toBe("9.9.9");
});

test("POST /mcp tools/list returns the tool registry", async () => {
  const res = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { result?: { tools?: { name: string }[] } };
  expect(body.result?.tools?.length).toBeGreaterThan(0);
  expect(body.result?.tools?.map((t) => t.name)).toContain("pc_list_scenarios");
});

test("an unknown path is 404", async () => {
  const res = await fetch(`${base}/nope`);
  expect(res.status).toBe(404);
});

test("GET /mcp is 405 and advertises POST", async () => {
  const res = await fetch(`${base}/mcp`);
  expect(res.status).toBe(405);
  expect(res.headers.get("allow")).toBe("POST");
});
