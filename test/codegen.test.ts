import { test, expect } from "vitest";
import { loadKnowledge } from "../src/knowledge/load.js";
import { generateCall } from "../src/tools/generateCall.js";
import { migrateFromSdk } from "../src/tools/migrateFromSdk.js";
import type { ToolContext } from "../src/types.js";

const ctx: ToolContext = { knowledge: loadKnowledge("data"), docFetch: async () => ({ ok: true, excerpts: [] }) };

test("pc_generate_call returns the curated example for the language", async () => {
  const r = await generateCall.run({ id: "verify-mpn", language: "typescript" }, ctx);
  const data = r.data as any;
  expect(data.code).toContain("api.partnercenter.microsoft.com");
  expect(data.code).not.toMatch(/graph\.windows\.net/);
});

test("pc_generate_call notFounds an unknown scenario", async () => {
  const r = await generateCall.run({ id: "nope", language: "curl" }, ctx);
  expect(r.ok).toBe(false);
});

test("pc_migrate_from_sdk maps a known SDK pattern to a REST scenario", async () => {
  const r = await migrateFromSdk.run({ code: "partner.Customers.ById(id).Subscriptions.Get()" }, ctx);
  const data = r.data as any;
  expect(data.unmatched).toBe(false);
  expect(data.matches[0].scenario.id).toBe("list-customer-subscriptions");
});

test("pc_migrate_from_sdk reports unmatched for unrecognized code", async () => {
  const r = await migrateFromSdk.run({ code: "var x = 1;" }, ctx);
  expect((r.data as any).unmatched).toBe(true);
});
