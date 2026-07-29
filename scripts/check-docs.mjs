// Weekly freshness check. Fetches every docUrl the pack references, compares
// against the committed snapshot, and writes doc-report.md.
//
// Exits non-zero only on HIGH severity: a dead or moved page, a replaced page,
// a page that stopped being readable, or a source edit that changed a field the
// pack depends on. A source edit that touched only prose is reported as
// informational — the previous whole-page text hash could not tell the two
// apart, and opening an issue for every upstream typo fix made the signal
// worthless.
//
// Pass --update (or UPDATE_SNAPSHOT=1) to write the refreshed snapshot.
import { writeFileSync } from "node:fs";
import { loadKnowledge } from "../dist/knowledge/load.js";
import { fetchAll } from "../dist/docfacts/fetch.js";
import { readSnapshot, writeSnapshot } from "../dist/docfacts/snapshot.js";
import { checkDrift } from "../dist/docfacts/checks/drift.js";
import { hasErrors } from "../dist/docfacts/findings.js";
import { renderReport } from "../dist/docfacts/report.js";
import { refreshTocHrefs } from "../dist/docfacts/toc.js";
import { EXTRACTOR_VERSION } from "../dist/docfacts/types.js";

const STALE_DAYS = Number(process.env.STALE_DAYS ?? 180);
const update = process.env.UPDATE_SNAPSHOT === "1" || process.argv.includes("--update");

const knowledge = loadKnowledge("data");
const snapshot = readSnapshot();
const urls = [...new Set([
  ...knowledge.scenarios.map((s) => s.docUrl),
  ...knowledge.errors.map((e) => e.docUrl),
])].sort();

const fetched = await fetchAll(urls);
const { findings, fresh } = checkDrift(fetched, snapshot, knowledge.scenarios, new Date(), STALE_DAYS);

// The TOC is what coverage and retirement detection are computed from. Without
// re-reading it here, `retired-page` could never fire again and a newly
// documented endpoint could never surface as a gap -- only the manual
// docfacts:refresh ever touched it.
const toc = await refreshTocHrefs(snapshot.tocHrefs);
findings.push(...toc.findings);

const count = (severity) => findings.filter((f) => f.severity === severity).length;
const report = renderReport("Documentation freshness report", findings, [
  `Checked **${urls.length}** doc URLs across ${knowledge.scenarios.length} scenarios and ${knowledge.errors.length} errors.`,
  `High severity: **${count("error")}**`,
  `Warnings: **${count("warning")}**`,
  `Informational (source changed, dependent fields unchanged): **${count("info")}**`,
]);

writeFileSync("doc-report.md", report);
if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, report, { flag: "a" });
console.log(report);

if (update) {
  // extractorVersion must track the parser that produced the merged records.
  // Spreading the old snapshot kept the OLD header after a parser bump, which
  // would have made the header a lie and defeated the re-baseline gate.
  writeSnapshot({
    ...snapshot,
    extractorVersion: EXTRACTOR_VERSION,
    tocHrefs: toc.hrefs,
    pages: { ...snapshot.pages, ...fresh },
  });
  console.log("snapshot updated.");
}

process.exit(hasErrors(findings) ? 1 : 0);
