// Offline verification of the knowledge pack against the committed snapshot.
// Runs on every PR: no network, no flakiness. `check-docs` is the networked
// counterpart that refreshes what this reads.
import { writeFileSync } from "node:fs";
import { loadKnowledge } from "../dist/knowledge/load.js";
import { readSnapshot } from "../dist/docfacts/snapshot.js";
import { checkFields } from "../dist/docfacts/checks/fields.js";
import { checkCoverage } from "../dist/docfacts/checks/coverage.js";
import { hasErrors } from "../dist/docfacts/findings.js";
import { renderReport } from "../dist/docfacts/report.js";

const knowledge = loadKnowledge("data");
const snapshot = readSnapshot();
const findings = [...checkFields(snapshot, knowledge.scenarios), ...checkCoverage(snapshot, knowledge.scenarios)];

// checkFields emits at most one disposition per scenario, so these partition
// the pack. Report each class explicitly: a single "Skipped" number that
// counted only `field-skipped` hid `unverified` scenarios entirely, and a
// reader seeing "Checked 96 ... Skipped: 1" would conclude 95 were verified
// when the true figure could be lower.
const errors = findings.filter((f) => f.severity === "error").length;
const unreadable = findings.filter((f) => f.kind === "field-skipped" && f.severity === "warning").length;
const noSyntax = findings.filter((f) => f.kind === "field-skipped" && f.severity === "info").length;
const unverified = findings.filter((f) => f.kind === "unverified").length;
const verified = knowledge.scenarios.length - unreadable - noSyntax - unverified;

const report = renderReport("Pack verification", findings, [
  `Checked **${knowledge.scenarios.length}** scenarios against **${Object.keys(snapshot.pages).length}** snapshotted pages.`,
  `Verified against a documented request syntax: **${verified}**`,
  `Field errors: **${errors}**`,
  `Skipped — the page could not be read: **${unreadable}**`,
  `Skipped — the page documents no request syntax: **${noSyntax}**`,
  `Never verified — docUrl absent from the snapshot: **${unverified}**`,
  `Documented endpoints with no scenario: **${findings.filter((f) => f.kind === "coverage-gap").length}**`,
]);

writeFileSync("pack-report.md", report);
if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, report, { flag: "a" });
console.log(report);
process.exit(hasErrors(findings) ? 1 : 0);
