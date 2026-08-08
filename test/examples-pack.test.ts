import { test, expect } from "vitest";
import { loadKnowledge } from "../src/knowledge/load.js";
import { getScenario } from "../src/tools/getScenario.js";
import type { ToolContext } from "../src/types.js";

const knowledge = loadKnowledge("data");
const ctx: ToolContext = { knowledge, docFetch: async () => ({ ok: true, excerpts: [] }) };

test("every example belongs to a scenario that exists", () => {
  const ids = new Set(knowledge.scenarios.map((s) => s.id));
  for (const id of Object.keys(knowledge.examples)) {
    expect(ids.has(id), id).toBe(true);
  }
});

test("every example cites the same doc page as its scenario", () => {
  for (const [id, example] of Object.entries(knowledge.examples)) {
    const scenario = knowledge.scenarios.find((s) => s.id === id);
    expect(example.docUrl, id).toBe(scenario?.docUrl);
  }
});

test("every stored body is real JSON, never a string of one", () => {
  for (const [id, example] of Object.entries(knowledge.examples)) {
    expect(typeof example.body, id).not.toBe("string");
    expect(example.body, id).not.toBeNull();
  }
});

/**
 * A ratchet, like the scenario pack's. Examples come from live pages, so a
 * refresh that silently loses half of them would otherwise pass CI.
 */
test("the response-example coverage does not regress", () => {
  expect(Object.keys(knowledge.examples).length).toBeGreaterThanOrEqual(185);
});

test("pc_get_scenario returns the example alongside the record", async () => {
  const r = await getScenario.run({ id: "get-subscription-by-id" }, ctx);
  const data = r.data as { exampleResponse?: { httpStatus: number | null; body: unknown } };
  expect(data.exampleResponse).toBeTruthy();
  expect(data.exampleResponse?.httpStatus).toBe(200);
  expect(data.exampleResponse?.body).toHaveProperty("id");
});

test("a scenario whose page publishes no example simply omits it", async () => {
  const withoutExample = knowledge.scenarios.find((s) => !knowledge.examples[s.id]);
  expect(withoutExample, "expected at least one scenario without an example").toBeTruthy();
  const r = await getScenario.run({ id: withoutExample?.id ?? "" }, ctx);
  expect((r.data as { exampleResponse?: unknown }).exampleResponse).toBeUndefined();
});
