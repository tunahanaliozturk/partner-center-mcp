import { test, expect } from "vitest";
import { loadKnowledge } from "../src/knowledge/load.js";

const k = loadKnowledge("data");
const byId = new Map(k.scenarios.map((s) => [s.id, s]));

function scenario(id: string) {
  const found = byId.get(id);
  if (!found) throw new Error(`no scenario "${id}" in the pack`);
  return found;
}

test("batch G: customer identity, profiles and validation are addressable", () => {
  for (const id of [
    "search-customers", "get-customer-company-profile", "get-customer-billing-profile",
    "update-customer-billing-profile", "get-customer-organization", "get-customer-custom-domains",
    "add-verified-domain", "get-customer-validation-status", "get-partner-validation-codes",
    "get-country-validation-rules",
  ]) {
    expect(byId.has(id), id).toBe(true);
  }
});

test("the billing profile is written with PUT and declares the concurrency header", () => {
  const s = scenario("update-customer-billing-profile");
  expect(s.method).toBe("PUT");
  expect(s.headers.map((h) => h.name)).toContain("If-Match");
});

test("customer search documents the encoded filter, which is what breaks it", () => {
  const s = scenario("search-customers");
  const gotchas = s.gotchas.join(" ");
  expect(gotchas).toContain("starts_with");
  expect(gotchas).toMatch(/encod/i);
});
