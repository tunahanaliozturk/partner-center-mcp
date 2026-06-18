import { test, expect } from "vitest";
import { loadKnowledge } from "../src/knowledge/load.js";
import { listScenarios } from "../src/tools/listScenarios.js";
import { getScenario } from "../src/tools/getScenario.js";
import { searchDocs } from "../src/tools/searchDocs.js";
import type { ToolContext } from "../src/types.js";

const knowledge = loadKnowledge("data");
const ctx: ToolContext = { knowledge, docFetch: async () => ({ ok: true, excerpts: [{ title: "t", url: "https://learn.microsoft.com/x", text: "e" }] }) };

test("pc_list_scenarios lists all, and filters by area", async () => {
  const all = await listScenarios.run({}, ctx);
  expect((all.data as any[]).length).toBe(knowledge.scenarios.length);
  const subs = await listScenarios.run({ area: "subscriptions" }, ctx);
  expect((subs.data as any[]).every((s) => s.area === "subscriptions")).toBe(true);
});

test("pc_get_scenario returns a full record or notFound with suggestions", async () => {
  const got = await getScenario.run({ id: "verify-mpn" }, ctx);
  expect((got.data as any).path).toContain("/v1/profiles/mpn");
  const miss = await getScenario.run({ id: "nope" }, ctx);
  expect(miss.ok).toBe(false);
  expect(miss.suggestions).toBeTruthy();
});

test("pc_get_scenario enrich attaches live excerpts", async () => {
  const got = await getScenario.run({ id: "verify-mpn", enrich: true }, ctx);
  expect((got.data as any).liveDocs[0].url).toBe("https://learn.microsoft.com/x");
});

test("pc_search_docs returns excerpts", async () => {
  const r = await searchDocs.run({ query: "auth" }, ctx);
  expect((r.data as any).excerpts[0].url).toBe("https://learn.microsoft.com/x");
});
