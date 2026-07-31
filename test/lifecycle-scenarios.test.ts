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

test("batch B: renewal-time changes are addressable", () => {
  for (const id of [
    "create-scheduled-changes", "update-subscription-autorenew",
    "get-custom-term-end-dates", "update-software-billing-frequency",
  ]) {
    expect(byId.has(id), id).toBe(true);
  }
});

test("scheduled changes state the autorenew precondition and both instruction shapes", () => {
  const s = byId.get("create-scheduled-changes")!;
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
  expect(byId.get("get-subscription-upgrades")!.gotchas.join(" ")).toMatch(/legacy/i);
  expect(byId.get("get-subscription-transitions")!.gotchas.join(" ")).toContain("transitionEligibilities");
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
  expect(byId.get("get-order-provisioning-status")!.method).toBe("GET");
  expect(byId.get("get-subscription-provisioning-status")!.method).toBe("GET");
});

test("the add-on purchase explains that it updates the base subscription's order", () => {
  const s = byId.get("purchase-addon")!;
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
  expect(byId.get("migrate-to-new-commerce")!.gotchas.join(" ")).toContain("validate-migration");
});

test("cancelling a migration schedule is a POST to /cancel, not a DELETE", () => {
  const s = byId.get("cancel-migration-schedule")!;
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
  expect(byId.get("create-legacy-transfer")!.gotchas.join(" ")).toMatch(/legacy/i);
});

test("renaming a subscription writes friendlyName, the field the docs call the nickname", () => {
  const fields = byId.get("update-subscription-nickname")!.requestFields?.map((f) => f.name) ?? [];
  expect(fields).toEqual(expect.arrayContaining(["friendlyName"]));
});
