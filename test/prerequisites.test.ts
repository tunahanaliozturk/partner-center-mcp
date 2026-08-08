import { test, expect } from "vitest";
import { loadKnowledge } from "../src/knowledge/load.js";
import { planPrerequisites } from "../src/knowledge/prerequisites.js";
import { planPrerequisitesTool } from "../src/tools/planPrerequisites.js";
import type { ToolContext } from "../src/types.js";

const knowledge = loadKnowledge("data");
const ctx: ToolContext = { knowledge, docFetch: async () => ({ ok: true, excerpts: [] }) };

test("every producer names a scenario that exists", () => {
  const ids = new Set(knowledge.scenarios.map((s) => s.id));
  for (const p of knowledge.prerequisites) {
    expect(ids.has(p.producedBy), `${p.placeholder} -> ${p.producedBy}`).toBe(true);
  }
});

/**
 * The point of the map: every id a path asks for is either explained by a
 * producer or declared caller-supplied. An unresolved placeholder is a hole,
 * and this is what stops one being added silently.
 */
test("no scenario in the pack has an unexplained path placeholder", () => {
  const holes: string[] = [];
  for (const s of knowledge.scenarios) {
    const plan = planPrerequisites(knowledge, s);
    for (const u of plan.unresolved) holes.push(`${s.id}: {${u}}`);
  }
  expect(holes).toEqual([]);
});

test("a chain is ordered so a producer comes before whatever needs it", () => {
  const plan = planPrerequisites(knowledge, knowledge.scenarios.find((s) => s.id === "cancel-subscription")!);
  expect(plan.steps.map((s) => s.scenarioId)).toEqual(["list-customers", "list-customer-subscriptions"]);
  expect(plan.steps.map((s) => s.provides)).toEqual(["customer-id", "subscription-id"]);
});

test("a nested id pulls in its own producer first", () => {
  const plan = planPrerequisites(knowledge, knowledge.scenarios.find((s) => s.id === "get-batch-devices")!);
  const ids = plan.steps.map((s) => s.scenarioId);
  expect(ids.indexOf("list-customers")).toBeLessThan(ids.indexOf("get-device-batches"));
});

test("a placeholder that means two things resolves by route", () => {
  const configPolicy = planPrerequisites(knowledge, knowledge.scenarios.find((s) => s.id === "get-configuration-policy")!);
  expect(configPolicy.steps.map((s) => s.scenarioId)).toContain("get-configuration-policies");

  const selfServe = planPrerequisites(knowledge, knowledge.scenarios.find((s) => s.id === "update-selfserve-policy")!);
  expect(selfServe.steps.map((s) => s.scenarioId)).toContain("list-selfserve-policies");
  expect(selfServe.steps.map((s) => s.scenarioId)).not.toContain("get-configuration-policies");
});

test("a scenario that needs nothing looked up returns an empty chain", () => {
  const plan = planPrerequisites(knowledge, knowledge.scenarios.find((s) => s.id === "list-customers")!);
  expect(plan.steps).toEqual([]);
});

test("pc_plan_prerequisites drops the customer lookup when the id is supplied", async () => {
  const r = await planPrerequisitesTool.run(
    { id: "cancel-subscription", customerId: "c7f6e4b1-3a2d-4c5e-9f80-1b2c3d4e5f60" },
    ctx,
  );
  const data = r.data as { steps: { scenarioId: string; path: string }[]; target: { path: string } };
  expect(data.steps.map((s) => s.scenarioId)).toEqual(["list-customer-subscriptions"]);
  expect(data.target.path).not.toContain("{customer-id}");
  for (const step of data.steps) expect(step.path).not.toContain("{customer-id}");
});

test("pc_plan_prerequisites rejects an unknown scenario with suggestions", async () => {
  const r = await planPrerequisitesTool.run({ id: "cancel-subscriptionn" }, ctx);
  expect(r.ok).toBe(false);
});

test("pc_plan_prerequisites works for every scenario in the pack", async () => {
  for (const s of knowledge.scenarios) {
    const r = await planPrerequisitesTool.run({ id: s.id }, ctx);
    expect(r.ok, s.id).toBe(true);
  }
});
