import { test, expect } from "vitest";
import { parseTocHrefs, refreshTocHrefs, tocHrefToUrl } from "../src/docfacts/toc.js";
import { checkCoverage } from "../src/docfacts/checks/coverage.js";
import { emptySnapshot } from "../src/docfacts/snapshot.js";
import { EXTRACTOR_VERSION, type DocFacts, type Snapshot } from "../src/docfacts/types.js";
import type { Scenario } from "../src/knowledge/schema.js";

const covered = "https://learn.microsoft.com/partner-center/developer/create-a-customer";
const uncovered = "https://learn.microsoft.com/partner-center/developer/get-a-cart";
const conceptual = "https://learn.microsoft.com/partner-center/developer/get-started";

function facts(url: string, isEndpointPage: boolean): DocFacts {
  const requestSyntax = isEndpointPage ? { method: "GET", uri: "/v1/x" } : null;
  return {
    url, finalUrl: url, template: "partner-center", documentId: "d",
    sourceRepo: "MicrosoftDocs/partner-center-pr", sourceSha: "a".repeat(40), sourcePath: "p.md",
    msDate: null, updatedAt: null, title: url,
    requestSyntax,
    requestSyntaxes: requestSyntax ? [requestSyntax] : [],
    headerNames: [], bodyFields: [], isEndpointPage,
    extractionError: null, extractorVersion: EXTRACTOR_VERSION,
  };
}

const scenario = (docUrl: string): Scenario => ({
  id: "s1", area: "customers", title: "A", method: "GET", path: "/v1/x", authType: "app+user",
  headers: [], requestShape: null, responseShape: null,
  examples: { curl: "", csharp: "", typescript: "" }, gotchas: [],
  docUrl, lastVerified: "2026-07-01",
} as Scenario);

test("parseTocHrefs walks nested items and normalizes leading ./", () => {
  const toc = { items: [{ href: "./overview" }, { children: [{ href: "developer/create-a-customer" }, { items: [{ href: "developer/get-a-cart" }] }] }] };
  expect(parseTocHrefs(toc)).toEqual(["overview", "developer/create-a-customer", "developer/get-a-cart"]);
});

test("parseTocHrefs tolerates a shape it does not recognize", () => {
  expect(parseTocHrefs(null)).toEqual([]);
  expect(parseTocHrefs({})).toEqual([]);
});

test("tocHrefToUrl builds the canonical Learn URL", () => {
  expect(tocHrefToUrl("developer/create-a-customer")).toBe(covered);
});

// check-docs re-reads the TOC weekly so retirement detection and coverage do
// not freeze. The failure modes must not corrupt the snapshot: an empty list
// would mark every scenario's page retired at once.
test("refreshTocHrefs returns the fresh list when the fetch succeeds", async () => {
  const r = await refreshTocHrefs(["developer/old"], async () => ["developer/a", "developer/b"]);
  expect(r.hrefs).toEqual(["developer/a", "developer/b"]);
  expect(r.findings).toEqual([]);
});

test("refreshTocHrefs carries the previous list forward and reports a failed fetch", async () => {
  const r = await refreshTocHrefs(["developer/old"], async () => { throw new Error("503"); });
  expect(r.hrefs).toEqual(["developer/old"]);
  expect(r.findings).toHaveLength(1);
  expect(r.findings[0]?.kind).toBe("toc-unreadable");
  expect(r.findings[0]?.severity).toBe("warning");
  expect(r.findings[0]?.message).toContain("503");
});

test("refreshTocHrefs refuses to replace the list with an empty one", async () => {
  const r = await refreshTocHrefs(["developer/old"], async () => []);
  expect(r.hrefs).toEqual(["developer/old"]);
  expect(r.findings[0]?.kind).toBe("toc-unreadable");
});

function snapshot(): Snapshot {
  const snap = emptySnapshot("2026-07");
  snap.tocHrefs = ["developer/create-a-customer", "developer/get-a-cart", "developer/get-started"];
  snap.pages[covered] = facts(covered, true);
  snap.pages[uncovered] = facts(uncovered, true);
  snap.pages[conceptual] = facts(conceptual, false);
  return snap;
}

test("an endpoint page with no scenario is an informational gap", () => {
  const findings = checkCoverage(snapshot(), [scenario(covered)]);
  const gaps = findings.filter((f) => f.kind === "coverage-gap");
  expect(gaps).toHaveLength(1);
  expect(gaps[0]?.ref).toBe(uncovered);
  expect(gaps[0]?.severity).toBe("info");
});

test("conceptual pages are never reported as gaps", () => {
  expect(checkCoverage(snapshot(), [scenario(covered)]).some((f) => f.ref === conceptual)).toBe(false);
});

test("a scenario whose page left the TOC is a retirement candidate", () => {
  const snap = snapshot();
  snap.tocHrefs = ["developer/get-a-cart", "developer/get-started"];
  const findings = checkCoverage(snap, [scenario(covered)]);
  expect(findings.some((f) => f.kind === "retired-page" && f.severity === "warning" && f.ref === "s1")).toBe(true);
});

test("a page listed under more than one TOC node is reported as a gap only once", () => {
  const snap = snapshot();
  snap.tocHrefs = ["developer/create-a-customer", "developer/get-a-cart", "developer/get-a-cart", "developer/get-started"];
  const findings = checkCoverage(snap, [scenario(covered)]);
  const gaps = findings.filter((f) => f.kind === "coverage-gap" && f.ref === uncovered);
  expect(gaps).toHaveLength(1);
});
