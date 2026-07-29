import type { Scenario } from "../../knowledge/schema.js";
import type { Finding } from "../findings.js";
import { tocHrefToUrl } from "../toc.js";
import type { Snapshot } from "../types.js";

function canonical(url: string): string {
  try {
    return new URL(url).pathname.replace(/^\/[a-z]{2}-[a-z]{2}\//i, "/").replace(/\/$/, "").toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

/**
 * Gaps are informational by design. 247 documented developer pages had no
 * scenario when this was written; making them errors would leave CI red
 * forever. They are a work list for sub-project B, not a build failure.
 */
export function checkCoverage(snapshot: Snapshot, scenarios: Scenario[]): Finding[] {
  const findings: Finding[] = [];
  const covered = new Set(scenarios.map((s) => canonical(s.docUrl)));

  for (const href of snapshot.tocHrefs) {
    if (!href.startsWith("developer/")) continue;
    const url = tocHrefToUrl(href);
    const facts = snapshot.pages[url];
    if (!facts?.isEndpointPage) continue;
    if (covered.has(canonical(url))) continue;
    findings.push({
      kind: "coverage-gap", severity: "info", ref: url,
      message: `documented endpoint with no scenario: ${facts.requestSyntax?.method ?? "?"} ${facts.requestSyntax?.uri ?? "?"}`,
      detail: facts.title ?? undefined,
    });
  }

  const inToc = new Set(snapshot.tocHrefs.map((href) => canonical(tocHrefToUrl(href))));
  for (const scenario of scenarios) {
    const path = canonical(scenario.docUrl);
    if (!path.startsWith("/partner-center/")) continue;
    if (inToc.has(path)) continue;
    findings.push({
      kind: "retired-page", severity: "warning", ref: scenario.id,
      message: `${scenario.docUrl} is no longer listed in the Learn TOC; the page may have been retired.`,
    });
  }

  return findings;
}
