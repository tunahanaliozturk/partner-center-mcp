import { test, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { createHttpApp } from "../src/http/app.js";
import { loadKnowledge } from "../src/knowledge/load.js";
import { allTools } from "../src/tools/index.js";
import type { ToolContext } from "../src/types.js";

// Declaring an outputSchema is a promise the SDK enforces: it validates every
// tool's structuredContent before returning it, so a schema that disagrees with
// the real payload turns a working tool into a hard error at call time. These
// tests drive each tool over the real transport with the real knowledge pack so
// that mismatch fails here rather than in someone's client.

const ctx: ToolContext = {
  knowledge: loadKnowledge(join(process.cwd(), "data")),
  docFetch: async () => ({ ok: true, excerpts: [{ title: "t", url: "https://learn.microsoft.com/x", text: "x" }] }),
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

interface CallResult {
  result?: { structuredContent?: { ok?: boolean }; isError?: boolean; content?: { text?: string }[] };
  error?: { message?: string };
}

async function call(name: string, args: Record<string, unknown>): Promise<CallResult> {
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  return (await res.json()) as CallResult;
}

// A representative success-path argument set per tool. Anything the pack can
// resolve will do; the point is to exercise the real payload shape.
const HAPPY: Record<string, Record<string, unknown>> = {
  pc_list_scenarios: {},
  pc_get_scenario: { id: "get-invoices" },
  pc_search_docs: { query: "cart" },
  pc_auth_guidance: { authType: "app+user" },
  pc_check_auth: { code: "var ctx = new AuthenticationContext(\"https://graph.windows.net\");" },
  pc_generate_call: { id: "get-invoices", language: "curl" },
  pc_migrate_from_sdk: { code: "partner.Customers.ById(id).Subscriptions.Get();" },
  pc_lookup_error: { httpStatus: 400 },
  pc_diagnose: { symptom: "unauthorized when calling partner center" },
  pc_get_reference: { topic: "headers" },
  pc_validate_request: { method: "GET", url: "https://api.partnercenter.microsoft.com/v1/invoices" },
  pc_plan_purchase: {},
  pc_get_enums: {},
  pc_whats_new: {},
  pc_get_resource: {},
  pc_explain_lifecycle: {},
  pc_build_request: { id: "get-invoices" },
  pc_decode_error: { error: "{\"code\":\"900400\"}" },
  pc_plan_transfer: {},
  pc_plan_subscription_change: { operation: "cancel" },
  pc_plan_order_lifecycle: {},
  pc_plan_prerequisites: { id: "cancel-subscription" },
  pc_diff_pack: {},
  pc_explain_policy: { question: "how long to cancel" },
  pc_plan_gdap_onboarding: {},
  pc_plan_reconciliation: {},
  pc_plan_csp_onboarding: {},
  pc_plan_user_onboarding: {},
  pc_plan_user_offboarding: {},
};

test("every registered tool has a happy-path case here", () => {
  expect(Object.keys(HAPPY).sort()).toEqual(allTools.map((t) => t.name).sort());
});

test.each(allTools.map((t) => t.name))("%s returns output matching its declared schema", async (name) => {
  const body = await call(name, HAPPY[name] ?? {});
  // A schema mismatch surfaces as a JSON-RPC error or isError, never as data.
  expect(body.error?.message, `${name} failed structured-output validation`).toBeUndefined();
  expect(body.result?.isError, `${name}: ${body.result?.content?.[0]?.text}`).toBeFalsy();
  expect(body.result?.structuredContent?.ok).toBe(true);
});

// The failure envelope is validated by the same schema, so a tool that can
// return notFound() must be able to represent it. This is the path that
// actually broke clients before `suggestions` was declared.
test.each([
  ["pc_get_scenario", { id: "no-such-scenario" }],
  ["pc_generate_call", { id: "no-such-scenario", language: "curl" }],
  ["pc_build_request", { id: "no-such-scenario" }],
  ["pc_get_enums", { name: "noSuchEnum" }],
  ["pc_get_resource", { name: "NoSuchResource" }],
  ["pc_lookup_error", { code: "000000" }],
  ["pc_auth_guidance", { authType: "app-only", cloud: "commercial" }],
] as const)("%s returns a schema-valid envelope on the not-found path", async (name, args) => {
  const body = await call(name, args as Record<string, unknown>);
  expect(body.error?.message, `${name} failed structured-output validation`).toBeUndefined();
  expect(body.result?.isError, `${name}: ${body.result?.content?.[0]?.text}`).toBeFalsy();
  expect(typeof body.result?.structuredContent?.ok).toBe("boolean");
});

test("tools/list exposes titles, annotations, and output schemas", async () => {
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
  const body = (await res.json()) as {
    result?: { tools?: { name: string; title?: string; outputSchema?: unknown; annotations?: Record<string, unknown>; inputSchema?: { properties?: Record<string, { description?: string }> } }[] };
  };
  const tools = body.result?.tools ?? [];
  expect(tools.length).toBe(allTools.length);
  for (const tool of tools) {
    expect(tool.title, `${tool.name} has no title`).toBeTruthy();
    expect(tool.outputSchema, `${tool.name} has no outputSchema`).toBeTruthy();
    expect(tool.annotations?.readOnlyHint, `${tool.name} is not marked read-only`).toBe(true);
    // Every advertised parameter must arrive at the client with its description.
    for (const [param, schema] of Object.entries(tool.inputSchema?.properties ?? {})) {
      expect(schema.description, `${tool.name}.${param} lost its description over the wire`).toBeTruthy();
    }
  }
});
