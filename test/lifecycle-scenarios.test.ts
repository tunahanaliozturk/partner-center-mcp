import { test, expect } from "vitest";
import { loadKnowledge } from "../src/knowledge/load.js";

const k = loadKnowledge("data");
const byId = new Map(k.scenarios.map((s) => [s.id, s]));

function scenario(id: string) {
  const found = byId.get(id);
  if (!found) throw new Error(`no scenario "${id}" in the pack`);
  return found;
}

test("batch A: seat, cancel, suspend and reactivate are addressable by intent", () => {
  for (const id of [
    "change-subscription-quantity", "cancel-subscription", "cancel-software-purchase",
    "cancel-order-sandbox", "suspend-subscription", "reactivate-subscription",
  ]) {
    expect(byId.has(id), id).toBe(true);
  }
});

test("cancellation scenarios point at the authoritative window field, not a fixed duration", () => {
  const gotchas = scenario("cancel-subscription").gotchas.join(" ");
  expect(gotchas).toContain("cancellationAllowedUntilDate");
  expect(gotchas).not.toMatch(/\b(7|72|168)\s*(day|days|hour|hours)\b/i);
});

test("seat reduction states the window constraint", () => {
  const gotchas = scenario("change-subscription-quantity").gotchas.join(" ");
  expect(gotchas).toContain("cancellationAllowedUntilDate");
});

test("batch B: renewal-time changes are addressable", () => {
  for (const id of [
    "create-scheduled-changes", "update-subscription-autorenew",
    "get-custom-term-end-dates", "update-software-billing-frequency",
  ]) {
    expect(byId.has(id), id).toBe(true);
  }
});

test("scheduled changes state the autorenew precondition and both instruction shapes", () => {
  const s = scenario("create-scheduled-changes");
  expect(s.gotchas.join(" ")).toContain("autoRenewEnabled");
  const fields = s.requestFields?.map((f) => f.name) ?? [];
  expect(fields).toEqual(expect.arrayContaining(["scheduledNextTermInstructions", "scheduledActions"]));
});

test("batch C: upgrade and conversion paths are addressable", () => {
  for (const id of [
    "get-subscription-upgrades", "get-subscription-transitions", "convert-trial-subscription",
    "get-trial-conversion-offers", "get-product-upgrade-eligibility", "get-product-upgrade-status",
  ]) {
    expect(byId.has(id), id).toBe(true);
  }
});

test("the legacy upgrade path is distinguished from the NCE transition path", () => {
  expect(scenario("get-subscription-upgrades").gotchas.join(" ")).toMatch(/legacy/i);
  expect(scenario("get-subscription-transitions").gotchas.join(" ")).toContain("transitionEligibilities");
});

test("batch D: the order lifecycle continues past checkout", () => {
  for (const id of [
    "get-subscription-addons", "purchase-addon", "create-cart-with-addons", "create-order",
    "update-cart", "get-order-provisioning-status", "get-subscription-provisioning-status",
    "get-order-activation-link",
  ]) {
    expect(byId.has(id), id).toBe(true);
  }
});

test("provisioning-status scenarios are GETs that read, never write", () => {
  expect(scenario("get-order-provisioning-status").method).toBe("GET");
  expect(scenario("get-subscription-provisioning-status").method).toBe("GET");
});

test("the add-on purchase explains that it updates the base subscription's order", () => {
  const s = scenario("purchase-addon");
  expect(s.method).toBe("PATCH");
  expect(s.gotchas.join(" ")).toContain("parentSubscriptionId");
});

test("batch E: migration is a lifecycle, not a single POST", () => {
  for (const id of [
    "validate-migration", "get-migration", "query-migrations", "get-migration-events",
    "create-migration-schedule", "get-migration-schedule", "update-migration-schedule",
    "cancel-migration-schedule",
  ]) {
    expect(byId.has(id), id).toBe(true);
  }
});

test("migrate-to-new-commerce points at validation before migrating", () => {
  expect(scenario("migrate-to-new-commerce").gotchas.join(" ")).toContain("validate-migration");
});

test("cancelling a migration schedule is a POST to /cancel, not a DELETE", () => {
  const s = scenario("cancel-migration-schedule");
  expect(s.method).toBe("POST");
  expect(s.path).toMatch(/\/cancel$/);
});

test("batch F: the transfer lifecycle is complete on both sides", () => {
  for (const id of [
    "accept-transfer", "reject-transfer", "withdraw-transfer", "update-transfer",
    "list-customer-transfers", "create-legacy-transfer", "update-subscription-nickname",
    "get-subscription-support-contact", "update-subscription-support-contact",
  ]) {
    expect(byId.has(id), id).toBe(true);
  }
});

test("the legacy transfer entry says which side of the transfer calls it", () => {
  expect(scenario("create-legacy-transfer").gotchas.join(" ")).toMatch(/legacy/i);
});

test("renaming a subscription writes friendlyName, the field the docs call the nickname", () => {
  const fields = scenario("update-subscription-nickname").requestFields?.map((f) => f.name) ?? [];
  expect(fields).toEqual(expect.arrayContaining(["friendlyName"]));
});
