// Golden eval harness: runs each case in data/evals.json against the real tools
// and checks the JSON output contains (and doesn't contain) expected strings.
// Deterministic and offline (docFetch is stubbed). Requires `npm run build` first.
import { readFileSync } from "node:fs";
import { allTools } from "../dist/tools/index.js";
import { loadKnowledge } from "../dist/knowledge/load.js";

const cases = JSON.parse(readFileSync(new URL("../data/evals.json", import.meta.url), "utf8")).cases;
const ctx = {
  knowledge: loadKnowledge("data"),
  // A canned excerpt rather than an empty list: pc_search_docs is a pass-through
  // to docFetch, so an empty stub leaves it with no testable behaviour.
  docFetch: async () => ({
    ok: true,
    excerpts: [
      { title: "Create a customer", url: "https://learn.microsoft.com/partner-center/developer/create-a-customer", text: "POST /v1/customers" },
      { title: "Get a customer", url: "https://learn.microsoft.com/partner-center/developer/get-a-customer-by-id", text: "GET /v1/customers/{customer-id}" },
    ],
    note: "stubbed",
  }),
};
const byName = new Map(allTools.map((t) => [t.name, t]));

// Every tool must be exercised. Without this, adding a tool silently ships it
// untested — five of them had accumulated that way.
const uncovered = allTools.map((t) => t.name).filter((name) => !cases.some((c) => c.tool === name));

let passed = 0;
const failures = [];

function valueAt(obj, path) {
  return path.split(".").reduce((acc, key) => (acc === null || acc === undefined ? undefined : acc[key]), obj);
}

for (const c of cases) {
  const tool = byName.get(c.tool);
  if (!tool) { failures.push(`${c.name}: unknown tool ${c.tool}`); continue; }
  let data;
  let blob;
  try {
    const res = await tool.run(c.input ?? {}, ctx);
    data = res.data ?? res;
    blob = JSON.stringify(data);
  } catch (e) {
    failures.push(`${c.name}: threw ${e?.message ?? e}`);
    continue;
  }
  const missing = (c.contains ?? []).filter((s) => !blob.includes(s));
  const leaked = (c.notContains ?? []).filter((s) => blob.includes(s));
  // A malformed assertion must be loud. Comparing serialized values means an
  // assertion written without an `equals` key compares undefined to undefined
  // and can NEVER fail -- a case that looks precise but asserts nothing.
  const wrong = (c.assert ?? []).map((a) => {
    if (a === null || typeof a !== "object") return `malformed assertion ${JSON.stringify(a)}: expected an object`;
    if (typeof a.path !== "string" || a.path === "") return `malformed assertion ${JSON.stringify(a)}: needs a non-empty string \`path\``;
    if (!("equals" in a)) return `malformed assertion at ${a.path}: needs an \`equals\` key (an absent one asserts nothing)`;
    const actual = valueAt(data, a.path);
    if (JSON.stringify(actual) === JSON.stringify(a.equals)) return null;
    return `${a.path}=${JSON.stringify(actual)} expected ${JSON.stringify(a.equals)}`;
  }).filter((m) => m !== null);

  if (missing.length || leaked.length || wrong.length) {
    const parts = [];
    if (missing.length) parts.push(`missing [${missing.join(", ")}]`);
    if (leaked.length) parts.push(`leaked [${leaked.join(", ")}]`);
    if (wrong.length) parts.push(`wrong [${wrong.join("; ")}]`);
    failures.push(`${c.name}: ${parts.join(" ")}`);
  } else {
    passed++;
  }
}

console.log(`eval: ${passed}/${cases.length} passed, ${allTools.length - uncovered.length}/${allTools.length} tools covered`);
for (const f of failures) console.log(`  ✗ ${f}`);
if (uncovered.length) console.log(`  ✗ no eval case for: ${uncovered.join(", ")}`);
if (failures.length || uncovered.length) process.exit(1);
