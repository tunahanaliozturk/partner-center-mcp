// Collect the response example Microsoft Learn publishes for each scenario and
// write them to data/examples.json. Run: npm run examples:refresh
//
// Nothing is invented here: an example is stored only when the page has a
// "Response example" section whose body parses as JSON. Pages without one are
// reported and skipped, so the file only ever holds what the docs actually say.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { extractResponseExample } from "../dist/examples/extract.js";

const root = new URL("../", import.meta.url);
const scenarios = JSON.parse(readFileSync(new URL("data/scenarios.json", root), "utf8")).scenarios;

// What is already on disk. A page that cannot be fetched this time keeps the
// example it had: Learn rate-limits a full sweep, and a run that hits a wall
// two thirds of the way through must not delete the work of the run before it.
const existingPath = new URL("data/examples.json", root);
const existing = existsSync(existingPath)
  ? JSON.parse(readFileSync(existingPath, "utf8")).examples ?? {}
  : {};

const CONCURRENCY = 4;
const stamp = new Date().toISOString().slice(0, 7);

async function fetchPage(url) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": "partner-center-mcp examples-refresh" } });
      if (res.ok) return await res.text();
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      return null;
    } catch {
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  return null;
}

const examples = {};
const fetched = new Set();
const missing = [];
let unreachable = 0;

async function worker(queue) {
  for (;;) {
    const scenario = queue.pop();
    if (!scenario) return;
    const html = await fetchPage(scenario.docUrl);
    if (html === null) {
      unreachable++;
      // Keep whatever the last successful run found for this page.
      if (existing[scenario.id]) examples[scenario.id] = existing[scenario.id];
      else missing.push(scenario.id);
      continue;
    }
    const example = extractResponseExample(html);
    if (!example) { missing.push(scenario.id); continue; }
    fetched.add(scenario.id);
    examples[scenario.id] = {
      httpStatus: example.httpStatus,
      body: example.body,
      docUrl: scenario.docUrl,
    };
  }
}

const queue = [...scenarios];
console.log(`fetching ${queue.length} pages...`);
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)));

// Sorted so a re-run produces a reviewable diff rather than a reordered file.
const sorted = Object.fromEntries(Object.keys(examples).sort().map((k) => [k, examples[k]]));
writeFileSync(
  new URL("data/examples.json", root),
  `${JSON.stringify({ version: stamp, examples: sorted }, null, 2)}\n`,
);

const covered = Object.keys(sorted).length;
const carried = Object.keys(sorted).filter((id) => !fetched.has(id)).length;
console.log(`wrote data/examples.json: ${covered}/${scenarios.length} scenarios have a response example`);
if (carried) console.log(`  ${carried} carried over from the previous run because the page was unreachable`);
if (unreachable) console.log(`  ${unreachable} pages were unreachable`);
if (missing.length) console.log(`  no example published for: ${missing.sort().join(", ")}`);
