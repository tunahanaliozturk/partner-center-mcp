// Offline verification of the knowledge pack against the committed snapshot.
// Runs on every PR: no network, no flakiness. `check-docs` is the networked
// counterpart that refreshes what this reads.
import { writeFileSync } from "node:fs";
import { loadKnowledge } from "../dist/knowledge/load.js";
import { readSnapshot } from "../dist/docfacts/snapshot.js";
import { checkFields } from "../dist/docfacts/checks/fields.js";
import { hasErrors } from "../dist/docfacts/findings.js";
import { renderReport } from "../dist/docfacts/report.js";

const knowledge = loadKnowledge("data");
const snapshot = readSnapshot();
const findings = checkFields(snapshot, knowledge.scenarios);

const errors = findings.filter((f) => f.severity === "error").length;
const skipped = findings.filter((f) => f.kind === "field-skipped").length;
const report = renderReport("Pack verification", findings, [
  `Checked **${knowledge.scenarios.length}** scenarios against **${Object.keys(snapshot.pages).length}** snapshotted pages.`,
  `Field errors: **${errors}**`,
  `Skipped (no comparable request syntax): **${skipped}**`,
]);

writeFileSync("pack-report.md", report);
if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, report, { flag: "a" });
console.log(report);
process.exit(hasErrors(findings) ? 1 : 0);
