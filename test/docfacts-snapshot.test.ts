import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "vitest";
import { emptySnapshot, readSnapshot, writeSnapshot } from "../src/docfacts/snapshot.js";
import { EXTRACTOR_VERSION, type DocFacts } from "../src/docfacts/types.js";

const dir = () => mkdtempSync(join(tmpdir(), "docfacts-"));

function facts(url: string): DocFacts {
  return {
    url, finalUrl: url, template: "partner-center",
    documentId: "doc-1", sourceRepo: "MicrosoftDocs/partner-center-pr",
    sourceSha: "a".repeat(40), sourcePath: "partner-center/developer/x.md",
    msDate: "2024-03-20T00:00:00Z", updatedAt: "2025-03-12T22:01:00Z", title: "X",
    requestSyntax: { method: "GET", uri: "/v1/customers" },
    requestSyntaxes: [{ method: "GET", uri: "/v1/customers" }],
    headerNames: [], bodyFields: [], isEndpointPage: true,
    extractionError: null, extractorVersion: EXTRACTOR_VERSION,
  };
}

test("a written snapshot round-trips", () => {
  const path = join(dir(), "doc-facts.json");
  const snap = emptySnapshot("2026-07");
  snap.tocHrefs = ["developer/create-a-customer"];
  snap.pages["https://learn.microsoft.com/a"] = facts("https://learn.microsoft.com/a");
  writeSnapshot(snap, path);
  expect(readSnapshot(path)).toEqual(snap);
});

test("writeSnapshot sorts keys so diffs stay readable", () => {
  const path = join(dir(), "doc-facts.json");
  const snap = emptySnapshot("2026-07");
  snap.tocHrefs = ["developer/b", "developer/a"];
  snap.pages["https://learn.microsoft.com/z"] = facts("https://learn.microsoft.com/z");
  snap.pages["https://learn.microsoft.com/a"] = facts("https://learn.microsoft.com/a");
  writeSnapshot(snap, path);
  const raw = readFileSync(path, "utf8");
  expect(raw.indexOf("learn.microsoft.com/a")).toBeLessThan(raw.indexOf("learn.microsoft.com/z"));
  expect(readSnapshot(path).tocHrefs).toEqual(["developer/a", "developer/b"]);
  expect(raw.endsWith("\n")).toBe(true);
});

test("readSnapshot rejects a malformed file with an actionable message", () => {
  const path = join(dir(), "doc-facts.json");
  writeFileSync(path, JSON.stringify({ version: "2026-07" }));
  expect(() => readSnapshot(path)).toThrow(/invalid/i);
});

test("readSnapshot explains how to create a missing snapshot", () => {
  expect(() => readSnapshot(join(dir(), "absent.json"))).toThrow(/docfacts:refresh/);
});

// EXTRACTOR_VERSION was written into every record and the snapshot header and
// read by nothing, so a parser change silently produced a snapshot-wide diff
// that looked like doc drift. The gate turns it into one deliberate re-baseline.
test("readSnapshot refuses a snapshot built by a different extractor version", () => {
  const path = join(dir(), "doc-facts.json");
  const snap = emptySnapshot("2026-07");
  snap.pages["https://learn.microsoft.com/a"] = facts("https://learn.microsoft.com/a");
  writeSnapshot(snap, path);
  const raw = JSON.parse(readFileSync(path, "utf8"));
  raw.extractorVersion = EXTRACTOR_VERSION - 1;
  writeFileSync(path, JSON.stringify(raw));

  expect(() => readSnapshot(path)).toThrow(new RegExp(`v${EXTRACTOR_VERSION - 1}`));
  expect(() => readSnapshot(path)).toThrow(/docfacts:refresh/);
});

test("readSnapshot accepts a snapshot at the current extractor version", () => {
  const path = join(dir(), "doc-facts.json");
  writeSnapshot(emptySnapshot("2026-07"), path);
  expect(readSnapshot(path).extractorVersion).toBe(EXTRACTOR_VERSION);
});
