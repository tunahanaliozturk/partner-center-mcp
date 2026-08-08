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

test("batch H: users, roles and partner relationships are addressable", () => {
  for (const id of [
    "get-user-by-id", "get-user-roles", "update-user-accounts", "list-deleted-users",
    "remove-reseller-relationship", "remove-delegated-admin",
    "create-indirect-reseller-customer", "list-indirect-reseller-customers",
  ]) {
    expect(byId.has(id), id).toBe(true);
  }
});

test("the two relationship removals are told apart, since they share a URI", () => {
  const reseller = scenario("remove-reseller-relationship");
  const dap = scenario("remove-delegated-admin");
  expect(reseller.path).toBe(dap.path);
  expect(reseller.method).toBe(dap.method);
  // Each must name the field that distinguishes it, or a caller severs the wrong thing.
  expect(reseller.requestFields?.map((f) => f.name)).toContain("relationshipToPartner");
  expect(dap.requestFields?.map((f) => f.name)).toContain("allowDelegatedAccess");
  expect(reseller.gotchas.join(" ")).toContain("remove-delegated-admin");
  expect(dap.gotchas.join(" ")).toContain("remove-reseller-relationship");
});

test("deleted users are found through the filtered user list", () => {
  expect(scenario("list-deleted-users").path).toContain("filter");
  expect(scenario("list-deleted-users").gotchas.join(" ")).toContain("Inactive");
});

test("batch I: agreements, self-serve policies and managed services are addressable", () => {
  for (const id of [
    "get-customer-consent", "get-agreement-metadata", "get-direct-sign-status",
    "create-selfserve-policy", "list-selfserve-policies", "update-selfserve-policy",
    "delete-selfserve-policy", "get-managed-services", "update-organization-profile",
  ]) {
    expect(byId.has(id), id).toBe(true);
  }
});

test("the self-serve policy CRUD is complete on one route", () => {
  const methods = ["create-selfserve-policy", "list-selfserve-policies", "update-selfserve-policy", "delete-selfserve-policy"]
    .map((id) => scenario(id).method);
  expect(methods).toEqual(["POST", "GET", "PUT", "DELETE"]);
});

test("the partner's own organization profile is not confused with a customer's", () => {
  const s = scenario("update-organization-profile");
  expect(s.path).toBe("/v1/profiles/organization");
  expect(s.gotchas.join(" ")).toContain("get-customer-organization");
});
