import { test, expect } from "vitest";
import { loadKnowledge } from "../src/knowledge/load.js";

const k = loadKnowledge("data");
const byId = new Map(k.scenarios.map((s) => [s.id, s]));

test("batch A: seat, cancel, suspend and reactivate are addressable by intent", () => {
  for (const id of [
    "change-subscription-quantity", "cancel-subscription", "cancel-software-purchase",
    "cancel-order-sandbox", "suspend-subscription", "reactivate-subscription",
  ]) {
    expect(byId.has(id), id).toBe(true);
  }
});

test("cancellation scenarios point at the authoritative window field, not a fixed duration", () => {
  const gotchas = byId.get("cancel-subscription")!.gotchas.join(" ");
  expect(gotchas).toContain("cancellationAllowedUntilDate");
  expect(gotchas).not.toMatch(/\b(7|72|168)\s*(day|days|hour|hours)\b/i);
});

test("seat reduction states the window constraint", () => {
  const gotchas = byId.get("change-subscription-quantity")!.gotchas.join(" ");
  expect(gotchas).toContain("cancellationAllowedUntilDate");
});
