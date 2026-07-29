import { readFileSync } from "node:fs";
import { test, expect } from "vitest";
import { extractDocFacts, normalizeUri } from "../src/docfacts/extract.js";
import { EXTRACTOR_VERSION } from "../src/docfacts/types.js";

const fixture = (name: string) => readFileSync(`test/fixtures/docs/${name}`, "utf8");

const PC_URL = "https://learn.microsoft.com/partner-center/developer/create-a-customer";
const PC_FINAL = "https://learn.microsoft.com/en-us/partner-center/developer/create-a-customer";

test("normalizeUri strips the baseURL placeholder and the protocol token", () => {
  expect(normalizeUri("{baseURL} /v1/customers HTTP/1.1")).toBe("/v1/customers");
  expect(normalizeUri("{baseURL}/v1/customers/{customer-id}/carts HTTP/1.1")).toBe("/v1/customers/{customer-id}/carts");
  expect(normalizeUri("/v1/customers")).toBe("/v1/customers");
});

test("a Partner Center endpoint page yields identity, request syntax and body fields", () => {
  const facts = extractDocFacts(PC_URL, PC_FINAL, fixture("pc-endpoint.html"));
  expect(facts.url).toBe(PC_URL);
  expect(facts.finalUrl).toBe(PC_FINAL);
  expect(facts.template).toBe("partner-center");
  expect(facts.sourceRepo).toBe("MicrosoftDocs/partner-center-pr");
  expect(facts.sourceSha).toMatch(/^[0-9a-f]{40}$/);
  expect(facts.sourcePath).toBe("partner-center/developer/create-a-customer.md");
  expect(facts.documentId).toMatch(/^[0-9a-f-]{36}$/);
  expect(facts.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(facts.requestSyntax).toEqual({ method: "POST", uri: "/v1/customers" });
  expect(facts.isEndpointPage).toBe(true);
  expect(facts.bodyFields.map((f) => f.name)).toContain("BillingProfile");
  expect(facts.extractionError).toBeNull();
  expect(facts.extractorVersion).toBe(EXTRACTOR_VERSION);
});

test("a page that links to the shared headers article yields no header names", () => {
  // create-a-customer's Request headers section is a bullet list pointing at
  // the shared "Partner Center REST headers" page, not a table. Absent headers
  // must read as "not tabulated", never as an extraction failure.
  const facts = extractDocFacts(PC_URL, PC_FINAL, fixture("pc-endpoint.html"));
  expect(facts.headerNames).toEqual([]);
  expect(facts.extractionError).toBeNull();
});

test("a conceptual page extracts identity but is not an endpoint page", () => {
  const url = "https://learn.microsoft.com/partner-center/developer/enable-secure-app-model";
  const facts = extractDocFacts(url, url, fixture("pc-conceptual.html"));
  expect(facts.template).toBe("partner-center");
  expect(facts.sourceSha).toMatch(/^[0-9a-f]{40}$/);
  expect(facts.requestSyntax).toBeNull();
  expect(facts.isEndpointPage).toBe(false);
  expect(facts.extractionError).toBeNull();
});

test("a page without Learn metadata reports an extraction error rather than empty facts", () => {
  const url = "https://learn.microsoft.com/partner-center/developer/whatever";
  const facts = extractDocFacts(url, url, fixture("malformed.html"));
  expect(facts.extractionError).toContain("gitcommit");
  expect(facts.extractionError).toContain("document_id");
  expect(facts.sourceSha).toBeNull();
  expect(facts.isEndpointPage).toBe(false);
});
