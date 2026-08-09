// Fetches every docUrl referenced by the knowledge pack and writes the
// verification snapshot. The only entry point that talks to the network on a
// full re-baseline; `check-docs` handles the routine weekly comparison.
import { loadKnowledge } from "../dist/knowledge/load.js";
import { fetchAll } from "../dist/docfacts/fetch.js";
import { extractDocFacts } from "../dist/docfacts/extract.js";
import { emptySnapshot, writeSnapshot, SNAPSHOT_PATH } from "../dist/docfacts/snapshot.js";
import { fetchTocHrefs, tocHrefToUrl } from "../dist/docfacts/toc.js";

const knowledge = loadKnowledge("data");

console.log("fetching the Learn TOC...");
const tocHrefs = await fetchTocHrefs();

// developer/ is the API surface the scenario pack is built from. The rest are
// the sections a licensing team lives in: how customers, relationships, billing,
// pricing and security actually behave. Nothing there is an endpoint, so
// checkFields never looks at it, but the drift check does: these pages carry the
// rules data/policies.json states, and a rule outliving its page is the failure
// that matters.
const SNAPSHOT_SECTIONS = /^(developer|customers|billing|pricing|security|announcements)\//;
const sectionUrls = tocHrefs.filter((h) => SNAPSHOT_SECTIONS.test(h)).map(tocHrefToUrl);

const urls = [...new Set([
  ...knowledge.scenarios.map((s) => s.docUrl),
  ...knowledge.errors.map((e) => e.docUrl),
  ...knowledge.policies.map((p) => p.docUrl),
  ...sectionUrls,
])].sort();

console.log(`fetching ${urls.length} pages...`);
const fetched = await fetchAll(urls);

const snapshot = emptySnapshot(new Date().toISOString().slice(0, 7));
snapshot.tocHrefs = tocHrefs;
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
