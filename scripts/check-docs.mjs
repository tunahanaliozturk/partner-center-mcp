// Freshness check for the curated knowledge pack.
// - Verifies every docUrl still resolves (flags 404 / dead links).
// - Flags scenarios whose lastVerified is older than STALE_DAYS.
// Writes a markdown report to doc-report.md (and to the GitHub step summary when
// run in CI). Exits non-zero when anything needs attention, so CI can open an issue.

import { readFileSync, writeFileSync } from "node:fs";

const STALE_DAYS = Number(process.env.STALE_DAYS ?? 180);
const TIMEOUT_MS = 15000;
const CONCURRENCY = 6;
const UA = "partner-center-mcp-doccheck/1.0 (+https://github.com/tunahanaliozturk/partner-center-mcp)";

const read = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), "utf8"));
const scenarios = read("scenarios.json").scenarios;
const errors = read("errors.json").errors;

// Collect unique docUrls with the records that reference them.
const refs = new Map();
const add = (url, label) => {
  if (!url) return;
  if (!refs.has(url)) refs.set(url, []);
  refs.get(url).push(label);
};
for (const s of scenarios) add(s.docUrl, `scenario:${s.id}`);
for (const e of errors) add(e.docUrl, `error:${e.errorCode}`);

async function checkUrl(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "user-agent": UA, accept: "text/html" },
    });
    return { url, status: res.status, ok: res.status >= 200 && res.status < 400 };
  } catch (err) {
    return { url, status: 0, ok: false, error: String(err?.message ?? err) };
  } finally {
    clearTimeout(timer);
  }
}

// Simple concurrency-limited map.
async function pmap(items, limit, fn) {
  const out = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

const urls = [...refs.keys()];
const results = await pmap(urls, CONCURRENCY, checkUrl);
const dead = results.filter((r) => !r.ok);

// Staleness check.
const now = Date.now();
const stale = scenarios
  .map((s) => ({ id: s.id, lastVerified: s.lastVerified, ageDays: Math.floor((now - Date.parse(s.lastVerified)) / 86400000) }))
  .filter((s) => Number.isFinite(s.ageDays) && s.ageDays > STALE_DAYS)
  .sort((a, b) => b.ageDays - a.ageDays);

// Build the report.
const lines = [];
lines.push("# Documentation freshness report", "");
lines.push(`- Checked **${urls.length}** unique doc URLs across ${scenarios.length} scenarios and ${errors.length} errors.`);
lines.push(`- Dead/unreachable links: **${dead.length}**`);
lines.push(`- Scenarios stale (> ${STALE_DAYS} days): **${stale.length}**`, "");

if (dead.length) {
  lines.push("## ❌ Dead or unreachable links", "");
  for (const d of dead) {
    lines.push(`- ${d.status || "ERR"} — ${d.url}`);
    lines.push(`  - referenced by: ${refs.get(d.url).join(", ")}`);
    if (d.error) lines.push(`  - ${d.error}`);
  }
  lines.push("");
}

if (stale.length) {
  lines.push(`## ⚠️ Stale scenarios (re-verify against the docs and bump lastVerified)`, "");
  for (const s of stale) lines.push(`- \`${s.id}\` — last verified ${s.lastVerified} (${s.ageDays} days ago)`);
  lines.push("");
}

if (!dead.length && !stale.length) lines.push("✅ All doc links resolve and every scenario is within the freshness window.", "");

const report = lines.join("\n");
writeFileSync(new URL("../doc-report.md", import.meta.url), report);
if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, report, { flag: "a" });
console.log(report);

if (dead.length || stale.length) process.exit(1);
