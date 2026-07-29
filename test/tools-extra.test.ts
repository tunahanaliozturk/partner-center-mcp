import { test, expect } from "vitest";
import { loadKnowledge } from "../src/knowledge/load.js";
import { validateRequest } from "../src/tools/validateRequest.js";
import { planPurchase } from "../src/tools/planPurchase.js";
import { generateCall } from "../src/tools/generateCall.js";
import type { ToolContext } from "../src/types.js";

const ctx: ToolContext = { knowledge: loadKnowledge("data"), docFetch: async () => ({ ok: true, excerpts: [] }) };

test("pc_validate_request accepts a well-formed GET", async () => {
  const r = await validateRequest.run(
    { method: "GET", url: "https://api.partnercenter.microsoft.com/v1/customers/abc/subscriptions", headers: { Authorization: "Bearer x" } },
    ctx,
  );
  const d = r.data as any;
  expect(d.ok).toBe(true);
  expect(d.matched.id).toBe("list-customer-subscriptions");
});

test("pc_validate_request flags the wrong method", async () => {
  const r = await validateRequest.run(
    { method: "POST", url: "/v1/customers/abc/subscriptions", headers: { Authorization: "Bearer x" } },
    ctx,
  );
  const d = r.data as any;
  expect(d.ok).toBe(false);
  expect(d.findings.some((f: any) => /method/i.test(f.message))).toBe(true);
});

test("pc_validate_request rejects app-only on an app+user scenario", async () => {
  const r = await validateRequest.run(
    { method: "POST", url: "/v1/customers", authType: "app-only", headers: { Authorization: "Bearer x", "MS-RequestId": "g" } },
    ctx,
  );
  const d = r.data as any;
  expect(d.findings.some((f: any) => /app-only/i.test(f.message))).toBe(true);
});

test("pc_validate_request catches the retired graph.windows.net audience", async () => {
  const r = await validateRequest.run(
    { method: "GET", url: "/v1/customers/abc/subscriptions", headers: { Authorization: "Bearer x", "X-Aud": "https://graph.windows.net" } },
    ctx,
  );
  const d = r.data as any;
  expect(d.findings.some((f: any) => /graph\.windows\.net/i.test(f.message))).toBe(true);
});

test("pc_validate_request warns on a write without MS-RequestId", async () => {
  const r = await validateRequest.run(
    { method: "POST", url: "/v1/customers/abc/carts", headers: { Authorization: "Bearer x" } },
    ctx,
  );
  const d = r.data as any;
  expect(d.findings.some((f: any) => /MS-RequestId/i.test(f.message))).toBe(true);
});

test("pc_validate_request matches a Graph scenario from a full Graph URL", async () => {
  const r = await validateRequest.run(
    { method: "GET", url: "https://graph.microsoft.com/v1.0/tenantRelationships/delegatedAdminRelationships", headers: { Authorization: "Bearer x" } },
    ctx,
  );
  const d = r.data as any;
  expect(d.matched?.id).toBe("get-gdap-relationships");
});

test("pc_validate_request matches a Graph scenario from its bare (relative) path", async () => {
  const r = await validateRequest.run(
    { method: "GET", url: "/tenantRelationships/delegatedAdminRelationships", headers: { Authorization: "Bearer x" } },
    ctx,
  );
  const d = r.data as any;
  expect(d.matched?.id).toBe("get-gdap-relationships");
});

test("pc_plan_purchase returns the ordered NCE chain", async () => {
  const r = await planPurchase.run({ customerId: "abc", country: "US" }, ctx);
  const d = r.data as any;
  expect(d.steps[0].scenarioId).toBe("get-products");
  expect(d.steps.map((s: any) => s.scenarioId)).toContain("checkout-cart");
  expect(d.steps.every((s: any) => s.method && s.path && s.docUrl)).toBe(true);
});

test("pc_validate_request echoes a resolved absolute url on the matched scenario", async () => {
  const graph = (await validateRequest.run(
    { method: "GET", url: "/tenantRelationships/delegatedAdminRelationships", headers: { Authorization: "Bearer x" } },
    ctx,
  )).data as any;
  expect(graph.matched.path).toBe("/tenantRelationships/delegatedAdminRelationships");
  expect(graph.matched.url).toBe("https://graph.microsoft.com/v1.0/tenantRelationships/delegatedAdminRelationships");

  const pc = (await validateRequest.run(
    { method: "GET", url: "/v1/customers/abc/subscriptions", headers: { Authorization: "Bearer x" } },
    ctx,
  )).data as any;
  expect(pc.matched.url).toBe("https://api.partnercenter.microsoft.com/v1/customers/{customer-id}/subscriptions");
});

test("pc_plan_purchase emits a resolved absolute url per step, from the scenario's own api", async () => {
  const d = (await planPurchase.run({ customerId: "abc", country: "US" }, ctx)).data as any;
  const cart = d.steps.find((s: any) => s.scenarioId === "create-cart");
  expect(cart.url).toBe("https://api.partnercenter.microsoft.com" + cart.path);
  expect(d.steps.every((s: any) => s.url === "https://api.partnercenter.microsoft.com" + s.path)).toBe(true);

  // The chain is all Partner Center today, so prove `url` is derived from the
  // scenario's `api` rather than hardcoded by flipping one scenario to Graph.
  const scenarios = (ctx.knowledge as any).scenarios.map((s: any) =>
    s.id === "create-cart" ? { ...s, api: "graph" } : s);
  const asGraph = (await planPurchase.run({ customerId: "abc" }, { ...ctx, knowledge: { ...(ctx.knowledge as any), scenarios } })).data as any;
  const graphStep = asGraph.steps.find((s: any) => s.scenarioId === "create-cart");
  expect(graphStep.url).toBe("https://graph.microsoft.com/v1.0" + graphStep.path);
});

test("pc_generate_call now includes auth/retry helpers and notes by default", async () => {
  const r = await generateCall.run({ id: "list-customer-subscriptions", language: "typescript" }, ctx);
  const d = r.data as any;
  expect(d.helpers).toContain("getAccessToken");
  expect(d.notes.some((n: string) => /links\.next/i.test(n))).toBe(true);
});
