import { readFileSync } from "node:fs";
import { test, expect } from "vitest";
import { checkDrift } from "../src/docfacts/checks/drift.js";
import { extractDocFacts } from "../src/docfacts/extract.js";
import { emptySnapshot } from "../src/docfacts/snapshot.js";
import type { PageFetch } from "../src/docfacts/fetch.js";
import type { Snapshot } from "../src/docfacts/types.js";
import type { Scenario } from "../src/knowledge/schema.js";

const HTML = readFileSync("test/fixtures/docs/pc-endpoint.html", "utf8");
const URL_A = "https://learn.microsoft.com/partner-center/developer/create-a-customer";
const NOW = new Date("2026-07-29T00:00:00Z");

const page = (over: Partial<PageFetch> = {}): PageFetch =>
  ({ url: URL_A, finalUrl: URL_A, status: 200, html: HTML, error: null, ...over });

const scenario = (over: Partial<Scenario> = {}): Scenario => ({
  id: "s1", area: "customers", title: "A", method: "POST", path: "/v1/customers",
  authType: "app+user", headers: [], requestShape: null, responseShape: null,
  examples: { curl: "", csharp: "", typescript: "" }, gotchas: [],
  docUrl: URL_A, lastVerified: "2026-07-01", ...over,
} as Scenario);

function baseline(over: Partial<ReturnType<typeof extractDocFacts>> = {}): Snapshot {
  const snap = emptySnapshot("2026-07");
  snap.pages[URL_A] = { ...extractDocFacts(URL_A, URL_A, HTML), ...over };
  return snap;
}

test("an unchanged page produces no findings", () => {
  const { findings } = checkDrift([page()], baseline(), [scenario()], NOW, 180);
  expect(findings).toEqual([]);
});

test("a changed source commit with identical fields is informational, not an error", () => {
  const { findings } = checkDrift([page()], baseline({ sourceSha: "b".repeat(40) }), [scenario()], NOW, 180);
  expect(findings).toHaveLength(1);
  expect(findings[0]?.kind).toBe("drift-low");
  expect(findings[0]?.severity).toBe("info");
});

test("a changed source commit with a changed request path is an error", () => {
  const snap = baseline({ sourceSha: "b".repeat(40), requestSyntax: { method: "POST", uri: "/v1/old" } });
  const { findings } = checkDrift([page()], snap, [scenario()], NOW, 180);
  expect(findings.some((f) => f.kind === "drift" && f.severity === "error")).toBe(true);
  expect(findings.find((f) => f.kind === "drift")?.message).toContain("/v1/old");
});

test("a replaced page (new document_id) is an error even if fields match", () => {
  const { findings } = checkDrift([page()], baseline({ documentId: "old-id" }), [scenario()], NOW, 180);
  expect(findings.some((f) => f.kind === "page-replaced" && f.severity === "error")).toBe(true);
});

test("a moved page is an error, and locale-only redirects are not", () => {
  const moved = checkDrift([page({ finalUrl: "https://learn.microsoft.com/partner-center/developer/elsewhere" })], baseline(), [scenario()], NOW, 180);
  expect(moved.findings.some((f) => f.kind === "page-moved" && f.severity === "error")).toBe(true);

  const localeOnly = checkDrift([page({ finalUrl: "https://learn.microsoft.com/en-us/partner-center/developer/create-a-customer" })], baseline(), [scenario()], NOW, 180);
  expect(localeOnly.findings).toEqual([]);
});

test("a dead link is an error", () => {
  const { findings } = checkDrift([page({ status: 404, html: null })], baseline(), [scenario()], NOW, 180);
  expect(findings.some((f) => f.kind === "dead-link" && f.severity === "error")).toBe(true);
});

test("a page that stopped being readable is an error", () => {
  const { findings } = checkDrift([page({ html: "<p>nothing</p>" })], baseline(), [scenario()], NOW, 180);
  expect(findings.some((f) => f.kind === "extraction" && f.severity === "error")).toBe(true);
});

test("a stale scenario is a warning", () => {
  const { findings } = checkDrift([page()], baseline(), [scenario({ lastVerified: "2020-01-01" })], NOW, 180);
  expect(findings.some((f) => f.kind === "stale" && f.severity === "warning")).toBe(true);
});

test("fresh facts are returned so the caller can rewrite the snapshot", () => {
  const { fresh } = checkDrift([page()], baseline(), [scenario()], NOW, 180);
  expect(fresh[URL_A]?.requestSyntax).toEqual({ method: "POST", uri: "/v1/customers" });
});

test("a changed source commit with a changed requestSyntaxes list (but unchanged requestSyntax) is an error", () => {
  const snap = baseline({ sourceSha: "b".repeat(40), requestSyntaxes: [{ method: "POST", uri: "/v1/customers" }, { method: "GET", uri: "/v1/customers/extra" }] });
  const { findings } = checkDrift([page()], snap, [scenario()], NOW, 180);
  expect(findings.some((f) => f.kind === "drift" && f.severity === "error")).toBe(true);
});

test("a page not in the snapshot is a warning, not an error", () => {
  const { findings } = checkDrift([page()], emptySnapshot("2026-07"), [scenario()], NOW, 180);
  expect(findings).toHaveLength(1);
  expect(findings[0]?.kind).toBe("unbaselined");
  expect(findings[0]?.severity).toBe("warning");
});

test("an unparseable finalUrl falls back to string comparison instead of throwing", () => {
  const { findings } = checkDrift(
    [page({ finalUrl: "not-a-url" })],
    baseline({ finalUrl: "not-a-url" }),
    [scenario()],
    NOW,
    180,
  );
  expect(findings.some((f) => f.kind === "page-moved")).toBe(false);
});
