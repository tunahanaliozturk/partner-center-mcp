// Fetches every docUrl referenced by the knowledge pack and writes the
// verification snapshot. The only entry point that talks to the network on a
// full re-baseline; `check-docs` handles the routine weekly comparison.
import { loadKnowledge } from "../dist/knowledge/load.js";
import { fetchAll } from "../dist/docfacts/fetch.js";
import { extractDocFacts } from "../dist/docfacts/extract.js";
import { emptySnapshot, writeSnapshot, SNAPSHOT_PATH } from "../dist/docfacts/snapshot.js";

const knowledge = loadKnowledge("data");
const urls = [...new Set([
  ...knowledge.scenarios.map((s) => s.docUrl),
  ...knowledge.errors.map((e) => e.docUrl),
])].sort();

console.log(`fetching ${urls.length} pages...`);
const fetched = await fetchAll(urls);

const snapshot = emptySnapshot(new Date().toISOString().slice(0, 7));
let failed = 0;
for (const page of fetched) {
  if (page.html === null) {
    failed++;
    console.log(`  ! ${page.status || "ERR"} ${page.url}${page.error ? " — " + page.error : ""}`);
    continue;
  }
  snapshot.pages[page.url] = extractDocFacts(page.url, page.finalUrl, page.html);
}

const withErrors = Object.values(snapshot.pages).filter((p) => p.extractionError !== null);
writeSnapshot(snapshot);
console.log(`wrote ${SNAPSHOT_PATH}: ${Object.keys(snapshot.pages).length} pages, ${failed} unreachable, ${withErrors.length} with extraction errors`);
for (const page of withErrors) console.log(`  ? ${page.url} — ${page.extractionError}`);
