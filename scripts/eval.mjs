// Golden eval harness: runs each case in data/evals.json against the real tools
// and checks the JSON output contains (and doesn't contain) expected strings.
// Deterministic and offline (docFetch is stubbed). Requires `npm run build` first.
import { readFileSync } from "node:fs";
import { allTools } from "../dist/tools/index.js";
import { loadKnowledge } from "../dist/knowledge/load.js";

const cases = JSON.parse(readFileSync(new URL("../data/evals.json", import.meta.url), "utf8")).cases;
const ctx = { knowledge: loadKnowledge("data"), docFetch: async () => ({ ok: true, excerpts: [] }) };
const byName = new Map(allTools.map((t) => [t.name, t]));

let passed = 0;
const failures = [];

for (const c of cases) {
  const tool = byName.get(c.tool);
  if (!tool) { failures.push(`${c.name}: unknown tool ${c.tool}`); continue; }
  let blob;
  try {
    const res = await tool.run(c.input ?? {}, ctx);
    blob = JSON.stringify(res.data ?? res);
  } catch (e) {
    failures.push(`${c.name}: threw ${e?.message ?? e}`);
    continue;
  }
  const missing = (c.contains ?? []).filter((s) => !blob.includes(s));
  const leaked = (c.notContains ?? []).filter((s) => blob.includes(s));
  if (missing.length || leaked.length) {
    failures.push(`${c.name}: missing [${missing.join(", ")}]${leaked.length ? ` leaked [${leaked.join(", ")}]` : ""}`);
  } else {
    passed++;
  }
}

console.log(`eval: ${passed}/${cases.length} passed`);
for (const f of failures) console.log(`  ✗ ${f}`);
if (failures.length) process.exit(1);
