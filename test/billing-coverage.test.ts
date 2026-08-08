import { test, expect } from "vitest";
import { loadKnowledge } from "../src/knowledge/load.js";

const k = loadKnowledge("data");
const byId = new Map(k.scenarios.map((s) => [s.id, s]));

function scenario(id: string) {
  const found = byId.get(id);
  if (!found) throw new Error(`no scenario "${id}" in the pack`);
  return found;
}

const USAGE = [
  "get-partner-usage-summary", "get-all-customers-usage-records", "get-customer-usage-summary",
  "get-customer-subscriptions-usage-records", "get-subscription-usage-summary",
  "get-subscription-meter-usage", "get-subscription-resource-usage", "get-subscription-monthly-usage",
];

test("batch K: the Azure consumption usage family is addressable", () => {
  for (const id of USAGE) expect(byId.has(id), id).toBe(true);
});

test("every usage scenario warns the figures are unbilled estimates", () => {
  for (const id of USAGE) {
    expect(scenario(id).gotchas.join(" "), id).toMatch(/unbilled|estimate/i);
  }
});

test("the usage family states the 24-hour data delay somewhere", () => {
  const all = USAGE.map((id) => scenario(id).gotchas.join(" ")).join(" ");
  expect(all).toMatch(/24 hours/i);
});

test("batch L: spending budget, overage and service costs are addressable", () => {
  for (const id of [
    "get-usage-budget", "update-usage-budget", "get-subscription-overage",
    "update-subscription-overage", "get-service-costs-summary", "get-service-costs-lineitems",
  ]) {
    expect(byId.has(id), id).toBe(true);
  }
});

test("the spending budget is documented as a notification threshold, not a cap", () => {
  const g = scenario("update-usage-budget").gotchas.join(" ");
  expect(g).toMatch(/does not (stop|cap)|not a (hard )?cap/i);
});

test("overage is written with PUT and keyed by the Azure entitlement", () => {
  const s = scenario("update-subscription-overage");
  expect(s.method).toBe("PUT");
  expect(s.requestFields?.map((f) => f.name)).toContain("azureEntitlementId");
});

test("batch M: invoice summaries, estimates and consumption line items are addressable", () => {
  for (const id of [
    "get-invoice-summaries", "get-invoice-estimate-links", "get-invoice-billed-consumption",
    "get-invoice-unbilled-consumption", "list-orders-by-billing-cycle",
  ]) {
    expect(byId.has(id), id).toBe(true);
  }
});

test("each consumption line-item entry names its billinglineitems sibling", () => {
  for (const id of ["get-invoice-billed-consumption", "get-invoice-unbilled-consumption"]) {
    const s = scenario(id);
    expect(s.path, id).toContain("usagelineitems");
    expect(s.gotchas.join(" "), id).toContain("billinglineitems");
  }
});
