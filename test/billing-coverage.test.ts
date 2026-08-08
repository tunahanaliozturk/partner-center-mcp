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
