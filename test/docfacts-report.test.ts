import { test, expect } from "vitest";
import { renderReport } from "../src/docfacts/report.js";
import { hasErrors, type Finding } from "../src/docfacts/findings.js";

const findings: Finding[] = [
  { kind: "field-mismatch", severity: "error", ref: "s1", message: "path is /a but the docs say /b.", detail: "https://x/1" },
  { kind: "field-skipped", severity: "info", ref: "s2", message: "skipped: conceptual page." },
];

test("the report groups by kind and orders errors first", () => {
  const md = renderReport("Pack verification", findings, ["96 scenarios checked"]);
  expect(md).toContain("# Pack verification");
  expect(md).toContain("96 scenarios checked");
  expect(md.indexOf("field-mismatch")).toBeLessThan(md.indexOf("field-skipped"));
  expect(md).toContain("`s1`");
  expect(md).toContain("https://x/1");
});

test("an empty finding list renders a clean report", () => {
  expect(renderReport("Pack verification", [], [])).toContain("Nothing to report");
});

test("hasErrors keys off severity alone", () => {
  expect(hasErrors(findings)).toBe(true);
  expect(hasErrors(findings.slice(1))).toBe(false);
});
