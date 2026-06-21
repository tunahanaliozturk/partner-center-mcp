// Freshness check for the curated knowledge pack.
// - Verifies every docUrl still resolves (flags 404 / dead links).
// - Flags scenarios whose lastVerified is older than STALE_DAYS.
// - Hashes each page's main text and flags content drift vs data/doc-hashes.json.
// Writes a markdown report to doc-report.md (and to the GitHub step summary when
// run in CI). Exits non-zero when anything needs attention, so CI can open an issue.
// Run with UPDATE_HASHES=1 to (re)write the content-hash baseline.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";

// A stable-ish hash of the page's visible text (first 4k chars, tags/scripts stripped).
function contentHash(html) {
  const text = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 4000);
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

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
    const okStatus = res.status >= 200 && res.status < 400;
    const hash = okStatus ? contentHash(await res.text()) : null;
    return { url, status: res.status, ok: okStatus, hash };
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

// Content-drift vs the committed baseline (data/doc-hashes.json).
const hashesUrl = new URL("../data/doc-hashes.json", import.meta.url);
const baseline = existsSync(hashesUrl) ? JSON.parse(readFileSync(hashesUrl, "utf8")) : null;
const current = Object.fromEntries(results.filter((r) => r.ok && r.hash).map((r) => [r.url, r.hash]));
const updateBaseline = process.env.UPDATE_HASHES || process.argv.includes("--update") || !baseline;
const drifted = (baseline && !updateBaseline)
  ? results.filter((r) => r.ok && r.hash && baseline[r.url] && baseline[r.url] !== r.hash)
  : [];
if (updateBaseline) writeFileSync(hashesUrl, JSON.stringify(current, null, 2) + "\n");

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
lines.push(`- Scenarios stale (> ${STALE_DAYS} days): **${stale.length}**`);
lines.push(`- Pages with changed content vs baseline: **${drifted.length}**`, "");

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

if (drifted.length) {
  lines.push("## 🔄 Content changed since last verification (re-verify these)", "");
  for (const d of drifted) lines.push(`- ${d.url}\n  - referenced by: ${refs.get(d.url).join(", ")}`);
  lines.push("", "_Re-verify against the docs, bump lastVerified, then run `npm run check-docs:update` to refresh the baseline._", "");
}

if (!dead.length && !stale.length && !drifted.length) lines.push("✅ All doc links resolve, content is unchanged, and every scenario is within the freshness window.", "");

const report = lines.join("\n");
writeFileSync(new URL("../doc-report.md", import.meta.url), report);
if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, report, { flag: "a" });
console.log(report);

if (dead.length || stale.length || drifted.length) process.exit(1);
