import type { Scenario } from "../../knowledge/schema.js";
import { extractDocFacts } from "../extract.js";
import type { PageFetch } from "../fetch.js";
import type { Finding } from "../findings.js";
import type { DocFacts, Snapshot } from "../types.js";

/** Fields the knowledge pack actually depends on. A source edit that leaves all
 *  of these identical cannot have invalidated anything we serve.
 *
 *  requestSyntaxes is included, not just requestSyntax: checkFields (Task 6)
 *  matches a scenario's method/path against ANY entry in the full list, so the
 *  pack depends on the whole list, not just its first entry. */
const DEPENDED_ON = ["requestSyntax", "requestSyntaxes", "headerNames", "bodyFields"] as const;

/** The depended-on fields that differ, each with its before/after value.
 *
 *  Named rather than boolean because this comparison is now the PRIMARY drift
 *  trigger and fires independently of sourceSha, so a finding may be about
 *  headerNames or bodyFields alone; the message must say which. */
function changedFields(facts: DocFacts, before: DocFacts): { name: string; before: string; after: string }[] {
  const out: { name: string; before: string; after: string }[] = [];
  for (const name of DEPENDED_ON) {
    const b = JSON.stringify(before[name]);
    const a = JSON.stringify(facts[name]);
    if (a !== b) out.push({ name, before: b, after: a });
  }
  return out;
}

/** Learn redirects bare paths to a locale, which is not a move. */
function canonicalPath(url: string): string {
  try {
    return new URL(url).pathname.replace(/^\/[a-z]{2}-[a-z]{2}\//i, "/").replace(/\/$/, "").toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

export function checkDrift(
  fetched: PageFetch[],
  snapshot: Snapshot,
  scenarios: Scenario[],
  now: Date,
  staleDays: number,
): { findings: Finding[]; fresh: Record<string, DocFacts> } {
  const findings: Finding[] = [];
  const fresh: Record<string, DocFacts> = {};

  for (const page of fetched) {
    if (page.html === null) {
      findings.push({
        kind: "dead-link", severity: "error", ref: page.url,
        message: `unreachable (${page.status || "ERR"})${page.error ? ": " + page.error : ""}.`,
      });
      continue;
    }

    const facts = extractDocFacts(page.url, page.finalUrl, page.html);
    fresh[page.url] = facts;
    const before = snapshot.pages[page.url];

    if (!before) {
      findings.push({
        kind: "unbaselined", severity: "warning", ref: page.url,
        message: "not in the snapshot, so it has never been compared.",
        detail: "Run `npm run check-docs:update` to record it.",
      });
      continue;
    }

    if (facts.extractionError !== null && before.extractionError === null) {
      findings.push({
        kind: "extraction", severity: "error", ref: page.url,
        message: `became unreadable (${facts.extractionError}). The Learn template may have changed.`,
      });
      continue;
    }

    // Both continue: once the page has moved to a different destination, or
    // this url now serves a different document entirely, any further
    // sourceSha/field diff below would be comparing the old document against
    // a new, unrelated one -- a misleading diff, not a useful one.
    if (canonicalPath(page.finalUrl) !== canonicalPath(before.finalUrl)) {
      findings.push({
        kind: "page-moved", severity: "error", ref: page.url,
        message: `now redirects to ${page.finalUrl}.`,
      });
      continue;
    }

    if (facts.documentId !== before.documentId) {
      findings.push({
        kind: "page-replaced", severity: "error", ref: page.url,
        message: `document_id changed (${before.documentId} -> ${facts.documentId}); the page was replaced, not edited.`,
      });
      continue;
    }

    // A changed field is the primary trigger, INDEPENDENT of sourceSha. Learn
    // re-renders pages from an unchanged source (a template change is the
    // spec's own top risk), so gating this on sourceSha would let a changed
    // request path, header, or body field pass silently and permanently --
    // the weekly job runs without --update, so check-pack keeps comparing
    // against the stale snapshot forever.
    const changed = changedFields(facts, before);
    if (changed.length > 0) {
      findings.push({
        kind: "drift", severity: "error", ref: page.url,
        message: `a field the pack depends on changed: ${changed.map((c) => `${c.name} ${c.before} -> ${c.after}`).join("; ")}.`,
        detail: `requestSyntaxes ${JSON.stringify(before.requestSyntaxes)} -> ${JSON.stringify(facts.requestSyntaxes)}; headers ${JSON.stringify(before.headerNames)} -> ${JSON.stringify(facts.headerNames)}; bodyFields ${JSON.stringify(before.bodyFields)} -> ${JSON.stringify(facts.bodyFields)}`,
      });
    } else if (facts.sourceSha !== before.sourceSha) {
      findings.push({
        kind: "drift-low", severity: "info", ref: page.url,
        message: "source changed, but no field the pack depends on changed.",
        detail: `${before.sourceSha} -> ${facts.sourceSha}`,
      });
    }
  }

  const cutoff = now.getTime() - staleDays * 86400000;
  for (const scenario of scenarios) {
    const verified = Date.parse(scenario.lastVerified);
    if (Number.isFinite(verified) && verified < cutoff) {
      const age = Math.floor((now.getTime() - verified) / 86400000);
      findings.push({
        kind: "stale", severity: "warning", ref: scenario.id,
        message: `last verified ${scenario.lastVerified} (${age} days ago).`,
      });
    }
  }

  return { findings, fresh };
}
