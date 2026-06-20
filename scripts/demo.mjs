// Prints a short, readable "what it does" demo of the tools.
// Used to record assets/demo.gif via VHS (run `npm run build` first).
import { loadKnowledge } from "../dist/knowledge/load.js";
import { listScenarios } from "../dist/tools/listScenarios.js";
import { lookupError } from "../dist/tools/lookupError.js";
import { checkAuth } from "../dist/tools/checkAuth.js";
import { validateRequest } from "../dist/tools/validateRequest.js";

const E = String.fromCharCode(27);
const paint = (code, s) => `${E}[${code}m${s}${E}[0m`;
const bold = (s) => paint("1", s), cyan = (s) => paint("36", s), green = (s) => paint("32", s), red = (s) => paint("31", s), dim = (s) => paint("90", s);

const ctx = { knowledge: loadKnowledge("data"), docFetch: async () => ({ ok: true, excerpts: [] }) };
const run = (t, a) => t.run(a, ctx);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hr = () => console.log(dim("-".repeat(64)));

console.log(bold(cyan("partner-center-mcp")) + " — Partner Center REST API assistant\n");
await sleep(700);

const all = (await run(listScenarios, {})).data;
console.log(`${bold("pc_list_scenarios")} -> ${all.length} verified scenarios across ${new Set(all.map((s) => s.area)).size} areas`);
hr();
await sleep(900);

console.log(bold("pc_lookup_error") + ' { code: "900420" }');
const e = (await run(lookupError, { code: "900420" })).data;
console.log(`  ${e.httpStatus} ${e.errorCode}: ${e.description}`);
console.log(`  ${green("fix:")} ${e.remediation.slice(0, 80)}...`);
hr();
await sleep(1100);

console.log(bold("pc_check_auth") + " (legacy snippet)");
const c = (await run(checkAuth, { code: 'get("https://graph.windows.net"); new AuthenticationContext();' })).data;
for (const f of c.findings) console.log(`  ${red(f.severity)} ${f.message}`);
hr();
await sleep(1100);

console.log(bold("pc_validate_request") + " POST /v1/customers/{id}/subscriptions");
const v = (await run(validateRequest, { method: "POST", url: "/v1/customers/abc/subscriptions", headers: { Authorization: "Bearer x" } })).data;
for (const f of v.findings) console.log(`  ${red(f.severity)} ${f.message}`);
await sleep(800);
console.log("\n" + dim("Grounded in current Microsoft Learn docs. No credentials, no live calls."));
