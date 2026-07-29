import type { Scenario } from "../../knowledge/schema.js";
import type { Finding } from "../findings.js";
import type { Snapshot } from "../types.js";

function segments(path: string): string[] {
  return (path.split("?")[0] ?? "").split("/").filter((s) => s !== "");
}

/**
 * Placeholder segments are wildcards: the docs and the pack disagree on
 * spelling (`{customer-id}` vs `{customer_id}`) often enough that comparing
 * them would only produce noise. Literal segments and segment count are
 * compared strictly, which is where a genuinely changed route shows up.
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
    if (facts.requestSyntax === null) {
      findings.push({
        kind: "field-skipped", severity: "info", ref: scenario.id,
        message: `skipped: ${facts.url} documents no request syntax (conceptual page or unsupported template).`,
      });
      continue;
    }
    const matches = (entry: { method: string; uri: string }) =>
      scenario.method === entry.method && pathsMatch(scenario.path, entry.uri);

    if (!facts.requestSyntaxes.some(matches)) {
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
