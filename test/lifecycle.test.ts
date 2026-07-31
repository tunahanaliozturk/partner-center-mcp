import { test, expect } from "vitest";
import { loadKnowledge } from "../src/knowledge/load.js";
import { explainLifecycle } from "../src/tools/explainLifecycle.js";
import type { ToolContext } from "../src/types.js";

const knowledge = loadKnowledge("data");
const ctx: ToolContext = { knowledge, docFetch: async () => ({ ok: true, excerpts: [] }) };

test("every lifecycle operation names a real scenario, error and state", () => {
  const ids = new Set(knowledge.scenarios.map((s) => s.id));
  const codes = new Set(knowledge.errors.map((e) => e.errorCode));
  const states = new Set(knowledge.lifecycle.states);
  for (const op of knowledge.lifecycle.operations) {
    expect(ids.has(op.scenarioId), `${op.operation} -> ${op.scenarioId}`).toBe(true);
    expect(states.has(op.toState), `${op.operation} -> ${op.toState}`).toBe(true);
    for (const from of op.fromStates) expect(states.has(from), `${op.operation} <- ${from}`).toBe(true);
    for (const code of op.errorCodes) expect(codes.has(code), `${op.operation} -> ${code}`).toBe(true);
  }
});

test("the nine lifecycle operations are all modelled", () => {
  const names = knowledge.lifecycle.operations.map((o) => o.operation).sort();
  expect(names).toEqual([
    "cancel", "decrease-seats", "increase-seats", "migrate", "reactivate",
    "renew-change", "suspend", "transfer", "upgrade",
  ]);
});

test("guards name a field to read, never a remembered duration", () => {
  for (const op of knowledge.lifecycle.operations) {
    if (op.guard === null) continue;
    expect(op.guard.field.length, op.operation).toBeGreaterThan(0);
    expect(op.guard.condition, op.operation).not.toMatch(/\b(7|72|168)\s*(day|days|hour|hours)\b/i);
  }
});

test("pc_explain_lifecycle returns the whole machine with no argument", async () => {
  const r = await explainLifecycle.run({}, ctx);
  expect(r.ok).toBe(true);
  expect((r.data as { operations: unknown[] }).operations.length).toBe(9);
});

test("pc_explain_lifecycle narrows to one operation and states its guard", async () => {
  const r = await explainLifecycle.run({ operation: "decrease-seats" }, ctx);
  const data = r.data as { operations: { guard: { field: string } }[] };
  expect(data.operations.length).toBe(1);
  expect(data.operations[0].guard.field).toBe("cancellationAllowedUntilDate");
});

test("pc_explain_lifecycle rejects an unknown operation", async () => {
  const r = await explainLifecycle.run({ operation: "nope" }, ctx);
  expect(r.ok).toBe(false);
});
