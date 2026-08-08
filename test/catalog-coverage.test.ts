import { test, expect } from "vitest";
import { loadKnowledge } from "../src/knowledge/load.js";

const k = loadKnowledge("data");
const byId = new Map(k.scenarios.map((s) => [s.id, s]));

function scenario(id: string) {
  const found = byId.get(id);
  if (!found) throw new Error(`no scenario "${id}" in the pack`);
  return found;
}

test("batch P: the legacy offer catalog and the by-customer views are addressable", () => {
  for (const id of [
    "list-offers", "get-offer-by-id", "get-addon-offers", "list-offer-categories",
    "list-product-skus", "get-availability-by-id", "list-products-by-customer",
    "list-skus-by-customer", "list-availabilities-by-customer",
  ]) {
    expect(byId.has(id), id).toBe(true);
  }
});

test("the by-customer catalog reads are POSTs that carry no body", () => {
  for (const id of ["list-products-by-customer", "list-skus-by-customer", "list-availabilities-by-customer"]) {
    const s = scenario(id);
    expect(s.method, id).toBe("POST");
    expect(s.requestShape, id).toBeNull();
    expect(s.gotchas.join(" "), id).toMatch(/no body|without a body|POST/i);
  }
});

test("the legacy offer routes say what replaced them", () => {
  for (const id of ["list-offers", "get-offer-by-id"]) {
    expect(scenario(id).gotchas.join(" "), id).toMatch(/legacy|new commerce|get-products/i);
  }
});

test("batch Q: partner profiles, compliance, fraud and referral writes are addressable", () => {
  for (const id of [
    "get-partner-network-profile", "update-legal-business-profile", "update-support-profile",
    "validate-reseller-por", "verify-reseller-mpa-status", "update-fraud-event-status",
    "get-referral-by-id", "update-referral",
  ]) {
    expect(byId.has(id), id).toBe(true);
  }
});

test("the referral writes sit on the referrals host", () => {
  for (const id of ["get-referral-by-id", "update-referral"]) {
    expect(scenario(id).api, id).toBe("pricing-and-referrals");
  }
});

test("the MPN profile route without a query is distinguished from verify-mpn", () => {
  const s = scenario("get-partner-network-profile");
  expect(s.path).toBe("/v1/profiles/mpn");
  expect(s.gotchas.join(" ")).toContain("verify-mpn");
});
