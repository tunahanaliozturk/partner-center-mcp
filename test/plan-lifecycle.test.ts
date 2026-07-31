import { test, expect } from "vitest";
import { loadKnowledge } from "../src/knowledge/load.js";
import { planSubscriptionChange, planOrderLifecycle } from "../src/tools/planWorkflows.js";
import type { ToolContext } from "../src/types.js";

const knowledge = loadKnowledge("data");
const ctx: ToolContext = { knowledge, docFetch: async () => ({ ok: true, excerpts: [] }) };

test("pc_plan_subscription_change plans a cancellation through the window check", async () => {
  const r = await planSubscriptionChange.run({ operation: "cancel" }, ctx);
  const data = r.data as any;
  expect(data.steps.map((s: any) => s.scenarioId)).toEqual([
    "get-subscription-by-id", "cancel-subscription", "get-subscription-provisioning-status",
  ]);
  expect(data.notes.join(" ")).toContain("cancellationAllowedUntilDate");
});

test("pc_plan_subscription_change covers every lifecycle operation", async () => {
  for (const op of knowledge.lifecycle.operations) {
    const r = await planSubscriptionChange.run({ operation: op.operation }, ctx);
    expect(r.ok, op.operation).toBe(true);
    expect((r.data as any).steps.length, op.operation).toBeGreaterThan(0);
  }
});

test("every planned step names a scenario that exists", async () => {
  const ids = new Set(knowledge.scenarios.map((s) => s.id));
  for (const op of knowledge.lifecycle.operations) {
    const r = await planSubscriptionChange.run({ operation: op.operation }, ctx);
    for (const step of (r.data as any).steps) {
      expect(ids.has(step.scenarioId), `${op.operation} -> ${step.scenarioId}`).toBe(true);
    }
  }
});

test("pc_plan_subscription_change rejects an unknown operation", async () => {
  const r = await planSubscriptionChange.run({ operation: "nope" }, ctx);
  expect(r.ok).toBe(false);
});

test("pc_plan_subscription_change substitutes the customer id into every step", async () => {
  const r = await planSubscriptionChange.run(
    { operation: "suspend", customerId: "c7f6e4b1-3a2d-4c5e-9f80-1b2c3d4e5f60" },
    ctx,
  );
  for (const step of (r.data as any).steps) {
    expect(step.path).not.toContain("{customer-id}");
    expect(step.url).toContain("c7f6e4b1-3a2d-4c5e-9f80-1b2c3d4e5f60");
  }
});

test("the guarded operations carry their guard field into the plan notes", async () => {
  for (const op of knowledge.lifecycle.operations) {
    if (op.guard === null) continue;
    const r = await planSubscriptionChange.run({ operation: op.operation }, ctx);
    expect((r.data as any).notes.join(" "), op.operation).toContain(op.guard.field);
  }
});

test("pc_plan_order_lifecycle runs from cart to provisioned subscriptions", async () => {
  const r = await planOrderLifecycle.run({}, ctx);
  const ids = (r.data as any).steps.map((s: any) => s.scenarioId);
  expect(ids).toEqual([
    "create-cart", "checkout-cart", "get-order-provisioning-status",
    "get-subscriptions-by-order", "get-subscription-provisioning-status",
  ]);
});
