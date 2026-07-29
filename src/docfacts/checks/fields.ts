import { baseUrlFor } from "../../knowledge/apis.js";
import type { Scenario } from "../../knowledge/schema.js";
import type { Finding } from "../findings.js";
import type { Snapshot } from "../types.js";

// Strip a leading scheme+host (e.g. "https://api.partner.microsoft.com") so
// an absolute doc URI segments the same way as the pack's relative path.
function stripOrigin(path: string): string {
  return path.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, "");
}

function segments(path: string): string[] {
  return (stripOrigin(path).split("?")[0] ?? "").split("/").filter((s) => s !== "");
}

/**
 * Placeholder segments are wildcards: the docs and the pack disagree on
 * spelling (`{customer-id}` vs `{customer_id}`) often enough that comparing
 * them would only produce noise. Literal segments and segment count are
 * compared strictly, which is where a genuinely changed route shows up.
 *
 * Either side may be an absolute URL (the referrals doc states its URI with
 * scheme+host); `segments` strips that before comparing, so this remains a
 * pure path/segment comparison and does not implicitly normalize versions.
 */
export function pathsMatch(scenarioPath: string, docUri: string): boolean {
  const left = segments(scenarioPath);
  const right = segments(docUri);
  if (left.length !== right.length) return false;
  return left.every((segment, i) => {
    const other = right[i] ?? "";
    if (segment.startsWith("{") || other.startsWith("{")) return true;
    return segment.toLowerCase() === other.toLowerCase();
  });
}

/**
 * The origin of a documented URI, or null when the URI is stated relatively.
 *
 * `pathsMatch` deliberately strips scheme+host from both sides, so nothing
 * else in this file can catch a scenario pointing its `api` at the wrong host.
 */
function originOf(uri: string): string | null {
  const match = /^[a-z][a-z0-9+.-]*:\/\/[^/\s]+/i.exec(uri.trim());
  if (!match) return null;
  try {
    return new URL(match[0]).origin;
  } catch {
    return null;
  }
}

export function checkFields(snapshot: Snapshot, scenarios: Scenario[]): Finding[] {
  const findings: Finding[] = [];
  for (const scenario of scenarios) {
    const facts = snapshot.pages[scenario.docUrl];
    if (!facts) {
      findings.push({
        kind: "unverified", severity: "warning", ref: scenario.id,
        message: `${scenario.docUrl} is not in the snapshot, so this scenario is never verified.`,
        detail: "Run `npm run docfacts:refresh`.",
      });
      continue;
    }
    if (facts.extractionError !== null) {
      findings.push({
        kind: "field-skipped", severity: "warning", ref: scenario.id,
        message: `skipped: the page could not be read (${facts.extractionError}).`,
      });
      continue;
    }
    // `api` selects the request host, and until now nothing verified it: the
    // path comparison strips scheme+host from both sides, so a scenario could
    // claim api "graph" against a Partner Center page and pass while
    // buildRequest sent to the wrong host. Graph pages use a distinct Learn
    // template, which makes this an exact iff.
    if ((scenario.api === "graph") !== (facts.template === "graph")) {
      findings.push({
        kind: "field-api", severity: "error", ref: scenario.id,
        message: scenario.api === "graph"
          ? `declares api "graph" but ${facts.url} is a ${facts.template} page.`
          : `declares api "${scenario.api ?? "partner-center"}" but ${facts.url} is a Microsoft Graph page.`,
        detail: `requests would be sent to ${baseUrlFor(scenario.api)}.`,
      });
    }

    if (facts.requestSyntax === null) {
      findings.push({
        kind: "field-skipped", severity: "info", ref: scenario.id,
        message: `skipped: ${facts.url} documents no request syntax (conceptual page or unsupported template).`,
      });
      continue;
    }
    const matches = (entry: { method: string; uri: string }) =>
      scenario.method === entry.method && pathsMatch(scenario.path, entry.uri);

    const matched = facts.requestSyntaxes.find(matches);

    // When the docs state the URI absolutely (the referrals pages do), its
    // origin is the authoritative host for this route. It must be the origin
    // the scenario's `api` resolves to, or the pack builds a request against
    // a host the documentation never mentions.
    if (matched) {
      const documented = originOf(matched.uri);
      const declared = new URL(baseUrlFor(scenario.api)).origin;
      if (documented !== null && documented !== declared) {
        findings.push({
          kind: "field-api", severity: "error", ref: scenario.id,
          message: `api "${scenario.api ?? "partner-center"}" resolves to ${declared} but the docs state ${documented}.`,
          detail: `${facts.url}: ${matched.uri}`,
        });
      }
    }

    if (!matched) {
      // No documented syntax matches. Pick the entry that is the closest fit
      // so the finding stays actionable instead of listing every candidate:
      // prefer a path match (report the method difference), then a method
      // match (report the path difference), then just the first entry.
      const pathMatch = facts.requestSyntaxes.find((e) => pathsMatch(scenario.path, e.uri));
      const methodMatch = facts.requestSyntaxes.find((e) => e.method === scenario.method);
      const closest = pathMatch ?? methodMatch ?? facts.requestSyntaxes[0];
      if (closest) {
        const ambiguity = facts.requestSyntaxes.length > 1
          ? ` (the page documents ${facts.requestSyntaxes.length} candidate request syntaxes; none matched)`
          : "";
        const detail = `${facts.url}${ambiguity}`;
        if (scenario.method !== closest.method) {
          findings.push({
            kind: "field-mismatch", severity: "error", ref: scenario.id,
            message: `method is ${scenario.method} but the docs say ${closest.method}.`,
            detail,
          });
        }
        if (!pathsMatch(scenario.path, closest.uri)) {
          findings.push({
            kind: "field-mismatch", severity: "error", ref: scenario.id,
            message: `path is ${scenario.path} but the docs say ${closest.uri}.`,
            detail,
          });
        }
      }
    }
    const declared = new Set(scenario.headers.map((h) => h.name.toLowerCase()));
    const undeclared = facts.headerNames.filter((name) => !declared.has(name.toLowerCase()));
    if (undeclared.length > 0) {
      findings.push({
        kind: "field-header", severity: "warning", ref: scenario.id,
        message: `the docs tabulate header(s) the scenario omits: ${undeclared.join(", ")}.`,
        detail: facts.url,
      });
    }
  }
  return findings;
}
