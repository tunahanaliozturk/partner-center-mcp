// Compare the working scenario pack against the last recorded release.
//
//   npm run pack-diff                 print what changed since the recorded baseline
//   npm run pack-diff -- --record X   record it as release X in data/history.json
//                                     and move the baseline forward
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fingerprintPack, diffFingerprints } from "../dist/knowledge/fingerprint.js";

const root = new URL("../", import.meta.url);
const readJson = (rel, fallback) => {
  const url = new URL(rel, root);
  return existsSync(url) ? JSON.parse(readFileSync(url, "utf8")) : fallback;
};

const scenarios = JSON.parse(readFileSync(new URL("data/scenarios.json", root), "utf8")).scenarios;
const baselinePath = "verification/pack-fingerprints.json";
const baseline = readJson(baselinePath, { version: "0.0.0", fingerprints: {} });

const current = fingerprintPack(scenarios);
const diff = diffFingerprints(baseline.fingerprints, current);
const total = diff.added.length + diff.removed.length + diff.changed.length;

console.log(`baseline ${baseline.version} -> working tree`);
console.log(`  added   ${diff.added.length}${diff.added.length ? `: ${diff.added.join(", ")}` : ""}`);
console.log(`  changed ${diff.changed.length}${diff.changed.length ? `: ${diff.changed.join(", ")}` : ""}`);
console.log(`  removed ${diff.removed.length}${diff.removed.length ? `: ${diff.removed.join(", ")}` : ""}`);

const recordFlag = process.argv.indexOf("--record");
if (recordFlag === -1) {
  if (total === 0) console.log("nothing to record");
  process.exit(0);
}

const version = process.argv[recordFlag + 1];
if (!version) {
  console.error("--record needs a version, e.g. --record 0.17.0");
  process.exit(2);
}

const history = readJson("data/history.json", { version: "2026-08", releases: [] });
history.releases = history.releases.filter((r) => r.version !== version);
history.releases.unshift({
  version,
  date: new Date().toISOString().slice(0, 10),
  scenarioCount: scenarios.length,
  added: diff.added,
  changed: diff.changed,
  removed: diff.removed,
});
history.version = new Date().toISOString().slice(0, 7);

writeFileSync(new URL("data/history.json", root), `${JSON.stringify(history, null, 2)}\n`);
writeFileSync(
  new URL(baselinePath, root),
  `${JSON.stringify({ version, fingerprints: current }, null, 2)}\n`,
);
console.log(`recorded release ${version} (${total} scenario changes) and moved the baseline`);
