import { test, expect } from "vitest";
import { checkFields, pathsMatch } from "../src/docfacts/checks/fields.js";
import { emptySnapshot } from "../src/docfacts/snapshot.js";
import { EXTRACTOR_VERSION, type DocFacts, type Snapshot } from "../src/docfacts/types.js";
import type { Scenario } from "../src/knowledge/schema.js";

const URL_A = "https://learn.microsoft.com/partner-center/developer/a";

function facts(over: Partial<DocFacts> = {}): DocFacts {
  const requestSyntax = over.requestSyntax !== undefined
    ? over.requestSyntax
    : { method: "GET", uri: "/v1/customers/{customer-id}/subscriptions" };
  return {
    url: URL_A, finalUrl: URL_A, template: "partner-center",
    documentId: "d1", sourceRepo: "MicrosoftDocs/partner-center-pr",
    sourceSha: "a".repeat(40), sourcePath: "p.md",
    msDate: null, updatedAt: null, title: "A",
    requestSyntax,
    requestSyntaxes: requestSyntax ? [requestSyntax] : [],
    headerNames: [], bodyFields: [], isEndpointPage: true,
    extractionError: null, extractorVersion: EXTRACTOR_VERSION, ...over,
  };
}

function scenario(over: Partial<Scenario> = {}): Scenario {
  return {
    id: "s1", area: "customers", title: "A", method: "GET",
    path: "/v1/customers/{customer-id}/subscriptions", authType: "app+user",
    headers: [], requestShape: null, responseShape: null,
    examples: { curl: "", csharp: "", typescript: "" },
    gotchas: [], docUrl: URL_A, lastVerified: "2026-07-01", ...over,
  } as Scenario;
}

function snapshotWith(f: DocFacts): Snapshot {
  const snap = emptySnapshot("2026-07");
  snap.pages[f.url] = f;
  return snap;
}

test("pathsMatch treats placeholders as wildcards but compares literals", () => {
  expect(pathsMatch("/v1/customers/{customer-id}/carts", "/v1/customers/{customer_id}/carts")).toBe(true);
  expect(pathsMatch("/v1/customers/{id}/carts", "/v1/customers/{id}/orders")).toBe(false);
  expect(pathsMatch("/v1/customers", "/v1/customers/{id}")).toBe(false);
  expect(pathsMatch("/v1/customers?size=2", "/v1/customers")).toBe(true);
});

test("pathsMatch strips a leading scheme+host from either side before comparing", () => {
  expect(pathsMatch("/v1.0/engagements/referrals", "https://api.partner.microsoft.com/v1.0/engagements/referrals")).toBe(true);
  expect(pathsMatch("https://api.partner.microsoft.com/v1.0/engagements/referrals", "/v1.0/engagements/referrals")).toBe(true);
  expect(pathsMatch("/v1.0/engagements/referrals", "https://api.partner.microsoft.com/v1.0/engagements/leads")).toBe(false);
});

test("a matching scenario produces no findings", () => {
  expect(checkFields(snapshotWith(facts()), [scenario()])).toEqual([]);
});

test("a wrong method is an error naming both sides", () => {
  const findings = checkFields(snapshotWith(facts()), [scenario({ method: "POST" })]);
  expect(findings).toHaveLength(1);
  expect(findings[0]?.severity).toBe("error");
  expect(findings[0]?.ref).toBe("s1");
  expect(findings[0]?.message).toContain("POST");
  expect(findings[0]?.message).toContain("GET");
});

test("a wrong path is an error", () => {
  const findings = checkFields(snapshotWith(facts()), [scenario({ path: "/v1/customers/{customer-id}/orders" })]);
  expect(findings.some((f) => f.severity === "error" && f.kind === "field-mismatch")).toBe(true);
});

test("a documented header the scenario omits is a warning, not an error", () => {
  const findings = checkFields(snapshotWith(facts({ headerNames: ["Authorization", "MS-RequestId"] })), [scenario()]);
  expect(findings.every((f) => f.severity === "warning")).toBe(true);
  expect(findings[0]?.message).toContain("MS-RequestId");
});

test("an unreadable page is skipped with a reason, never counted as passing", () => {
  const findings = checkFields(snapshotWith(facts({ extractionError: "no gitcommit meta", requestSyntax: null })), [scenario()]);
  expect(findings).toHaveLength(1);
  expect(findings[0]?.kind).toBe("field-skipped");
  expect(findings[0]?.message).toContain("no gitcommit meta");
});

test("a conceptual page is skipped, and a scenario missing from the snapshot is reported", () => {
  const skipped = checkFields(snapshotWith(facts({ requestSyntax: null, isEndpointPage: false })), [scenario()]);
  expect(skipped[0]?.kind).toBe("field-skipped");
  const absent = checkFields(emptySnapshot("2026-07"), [scenario()]);
  expect(absent[0]?.kind).toBe("unverified");
  expect(absent[0]?.severity).toBe("warning");
});

test("a header the scenario declares but the docs don't tabulate is not flagged", () => {
  const findings = checkFields(snapshotWith(facts()), [
    scenario({ headers: [{ name: "X-Extra", required: false }] }),
  ]);
  expect(findings).toEqual([]);
});

// A doc page can document more than one endpoint (e.g.
// transition-a-new-commerce-subscription): an eligibility GET and a
// transition POST. A scenario should match against any documented syntax,
// not just the first (canonical) one.
const twoSyntaxes = facts({
  requestSyntax: { method: "GET", uri: "/v1/customers/{customer-id}/transitionEligibilities" },
  requestSyntaxes: [
    { method: "GET", uri: "/v1/customers/{customer-id}/transitionEligibilities" },
    { method: "POST", uri: "/v1/customers/{customer-id}/transitions" },
  ],
});

test("a scenario matching the second of two documented syntaxes produces no findings", () => {
  const findings = checkFields(snapshotWith(twoSyntaxes), [
    scenario({ method: "POST", path: "/v1/customers/{customer-id}/transitions" }),
  ]);
  expect(findings).toEqual([]);
});

test("a scenario matching neither of two documented syntaxes reports how many candidates were considered", () => {
  const findings = checkFields(snapshotWith(twoSyntaxes), [
    scenario({ method: "DELETE", path: "/v1/customers/{customer-id}/cancel" }),
  ]);
  const errors = findings.filter((f) => f.severity === "error");
  expect(errors.length).toBeGreaterThan(0);
  expect(errors.every((f) => f.detail?.includes("2 candidate"))).toBe(true);
});
