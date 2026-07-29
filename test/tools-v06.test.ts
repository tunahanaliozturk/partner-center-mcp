import { test, expect } from "vitest";
import { loadKnowledge } from "../src/knowledge/load.js";
import { getEnums } from "../src/tools/getEnums.js";
import { whatsNew } from "../src/tools/whatsNew.js";
import { getResource } from "../src/tools/getResource.js";
import { buildRequest } from "../src/tools/buildRequest.js";
import { decodeError } from "../src/tools/decodeError.js";
import { planTransfer, planGdapOnboarding, planReconciliation } from "../src/tools/planWorkflows.js";
import type { ToolContext } from "../src/types.js";

const ctx: ToolContext = { knowledge: loadKnowledge("data"), docFetch: async () => ({ ok: true, excerpts: [] }) };

test("pc_get_enums lists and resolves an enum", async () => {
  const list = (await getEnums.run({}, ctx)).data as any[];
  expect(list.some((e) => e.name === "billingCycle")).toBe(true);
  const one = (await getEnums.run({ name: "billingcycle" }, ctx)).data as any;
  expect(one.values.some((v: any) => v.value === "monthly")).toBe(true);
});

test("pc_whats_new returns dated deprecations, filterable by status", async () => {
  const all = (await whatsNew.run({}, ctx)).data as any;
  expect(all.count).toBeGreaterThan(0);
  const enforced = (await whatsNew.run({ status: "enforced" }, ctx)).data as any;
  expect(enforced.items.every((i: any) => i.status === "enforced")).toBe(true);
});

test("pc_get_resource returns a field dictionary", async () => {
  const r = (await getResource.run({ name: "Subscription" }, ctx)).data as any;
  expect(r.fields.some((f: any) => f.name === "status")).toBe(true);
});

test("pc_build_request fills placeholders, headers, and a body skeleton", async () => {
  const r = (await buildRequest.run({ id: "create-cart", params: { "customer-id": "abc" } }, ctx)).data as any;
  expect(r.url).toBe("https://api.partnercenter.microsoft.com/v1/customers/abc/carts");
  expect(r.missingParams).toEqual([]);
  expect(Object.keys(r.headers).some((h) => h.toLowerCase() === "ms-requestid")).toBe(true);
  expect(r.body).toHaveProperty("lineItems");
  expect(Array.isArray(r.body.lineItems)).toBe(true);
});

test("pc_build_request reports missing params", async () => {
  const r = (await buildRequest.run({ id: "get-customer-by-id" }, ctx)).data as any;
  expect(r.missingParams).toContain("customer-id");
});

test("pc_build_request routes a Graph scenario to the Graph host with a Graph token", async () => {
  const r = (await buildRequest.run({ id: "get-gdap-relationships" }, ctx)).data as any;
  expect(r.url).toBe("https://graph.microsoft.com/v1.0/tenantRelationships/delegatedAdminRelationships");
  expect(r.headers.Authorization).toBe("Bearer <graph-access-token>");
});

test("pc_build_request for an ordinary Partner Center scenario is unchanged", async () => {
  const r = (await buildRequest.run({ id: "create-cart", params: { "customer-id": "abc" } }, ctx)).data as any;
  expect(r.url).toBe("https://api.partnercenter.microsoft.com/v1/customers/abc/carts");
});

test("pc_decode_error decodes a pasted error JSON and finds the correlation id", async () => {
  const r = (await decodeError.run({ error: '{"code":"900420","description":"bad audience","correlationId":"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"}' }, ctx)).data as any;
  expect(r.parsed.code).toBe("900420");
  expect(r.match.httpStatus).toBe(401);
  expect(r.parsed.correlationId).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
});

test("guided workflows return ordered, resolvable steps", async () => {
  for (const tool of [planTransfer, planGdapOnboarding, planReconciliation]) {
    const d = (await tool.run({ customerId: "abc" }, ctx)).data as any;
    expect(d.steps.length).toBeGreaterThan(1);
    expect(d.steps.every((s: any) => s.method && s.path && s.docUrl)).toBe(true);
  }
});

test("guided workflow steps carry a resolved absolute url, per step api", async () => {
  // pc_plan_gdap_onboarding is entirely Graph; pc_plan_transfer is entirely
  // Partner Center. A host-less path in either would send an agent to the
  // wrong host.
  const gdap = (await planGdapOnboarding.run({}, ctx)).data as any;
  const byId = gdap.steps.find((s: any) => s.scenarioId === "get-gdap-relationship-by-id");
  expect(byId.url).toBe("https://graph.microsoft.com/v1.0" + byId.path);
  expect(gdap.steps.every((s: any) => s.url.startsWith("https://graph.microsoft.com/v1.0/"))).toBe(true);

  const transfer = (await planTransfer.run({ customerId: "abc" }, ctx)).data as any;
  expect(transfer.steps.every((s: any) => s.url === "https://api.partnercenter.microsoft.com" + s.path)).toBe(true);
});

test("a filled placeholder is reflected in url, not just path", async () => {
  const d = (await planTransfer.run({ customerId: "abc" }, ctx)).data as any;
  const step = d.steps.find((s: any) => s.path.includes("/abc"));
  expect(step).toBeTruthy();
  expect(step.url).toBe("https://api.partnercenter.microsoft.com" + step.path);
  expect(step.url).not.toContain("{customer-id}");
});

test("pc_lookup_error resolves related scenarios", async () => {
  const r = (await import("../src/tools/lookupError.js")).lookupError;
  const d = (await r.run({ code: "13605" }, ctx)).data as any;
  expect(d.relatedScenarios.some((s: any) => s.id === "create-agreement")).toBe(true);
});
