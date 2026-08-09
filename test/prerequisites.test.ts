import { test, expect } from "vitest";
import { loadKnowledge } from "../src/knowledge/load.js";
import { planPrerequisites } from "../src/knowledge/prerequisites.js";
import { planPrerequisitesTool } from "../src/tools/planPrerequisites.js";
import type { ToolContext } from "../src/types.js";

const knowledge = loadKnowledge("data");
const ctx: ToolContext = { knowledge, docFetch: async () => ({ ok: true, excerpts: [] }) };

function scenario(id: string) {
  const found = knowledge.scenarios.find((s) => s.id === id);
  if (!found) throw new Error(`no scenario "${id}" in the pack`);
  return found;
}

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
  const plan = planPrerequisites(knowledge, scenario("cancel-subscription"));
  expect(plan.steps.map((s) => s.scenarioId)).toEqual(["list-customers", "list-customer-subscriptions"]);
  expect(plan.steps.map((s) => s.provides)).toEqual(["customer-id", "subscription-id"]);
});

test("a nested id pulls in its own producer first", () => {
  const plan = planPrerequisites(knowledge, scenario("get-batch-devices"));
  const ids = plan.steps.map((s) => s.scenarioId);
  expect(ids.indexOf("list-customers")).toBeLessThan(ids.indexOf("get-device-batches"));
});

test("a placeholder that means two things resolves by route", () => {
  const configPolicy = planPrerequisites(knowledge, scenario("get-configuration-policy"));
  expect(configPolicy.steps.map((s) => s.scenarioId)).toContain("get-configuration-policies");

  const selfServe = planPrerequisites(knowledge, scenario("update-selfserve-policy"));
  expect(selfServe.steps.map((s) => s.scenarioId)).toContain("list-selfserve-policies");
  expect(selfServe.steps.map((s) => s.scenarioId)).not.toContain("get-configuration-policies");
});

test("a scenario that needs nothing looked up returns an empty chain", () => {
  const plan = planPrerequisites(knowledge, scenario("list-customers"));
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

test("an unmapped placeholder is reported rather than silently dropped", () => {
  // The shipped map explains every placeholder in the pack, so the reporting
  // path is exercised against a pack with the map deliberately emptied.
  const withoutMap = { ...knowledge, prerequisites: [] };
  const plan = planPrerequisites(withoutMap, scenario("cancel-subscription"));
  expect(plan.steps).toEqual([]);
  expect(plan.unresolved).toEqual(expect.arrayContaining(["customer-id", "subscription-id"]));
});

test("a producer that needs what it produces is reported as caller supplied", () => {
  // get-subscription-by-id needs a subscription-id, so naming it the producer
  // of subscription-id is a cycle. The caller has to break it.
  const cyclic = {
    ...knowledge,
    prerequisites: [
      { placeholder: "customer-id", producedBy: "list-customers", note: "start here" },
      { placeholder: "subscription-id", producedBy: "get-subscription-by-id", note: "cyclic on purpose" },
    ],
  };
  const plan = planPrerequisites(cyclic, scenario("cancel-subscription"));
  expect(plan.callerSupplied).toContain("subscription-id");
  expect(plan.steps.map((s) => s.scenarioId)).not.toContain("get-subscription-by-id");
});

test("a producer naming a scenario that does not exist is reported, not thrown", () => {
  const broken = {
    ...knowledge,
    prerequisites: [{ placeholder: "customer-id", producedBy: "no-such-scenario", note: "gone" }],
  };
  const plan = planPrerequisites(broken, scenario("cancel-subscription"));
  expect(plan.unresolved).toContain("customer-id");
});
