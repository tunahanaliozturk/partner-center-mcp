# Deterministic Doc Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the knowledge pack's inferred content-hash drift signal with direct verification against Microsoft Learn — source commit identity, field-level comparison, coverage measurement, and a per-tool eval gate — with no LLM in the loop.

**Architecture:** One pure extractor turns a Learn HTML page into a normalized `DocFacts` record. A committed snapshot (`verification/doc-facts.json`) holds those records plus the Learn TOC listing. Three pure checks read the snapshot: field verification and coverage run offline on every PR (`check-pack`); drift compares freshly fetched pages against the snapshot in a weekly networked run (`check-docs`).

**Tech Stack:** TypeScript 7 (NodeNext, `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`), zod 4, vitest 4 with v8 coverage, Biome 2 (linter only), plain-Node `.mjs` CLI wrappers importing from `dist/`.

**Spec:** [`docs/superpowers/specs/2026-07-28-doc-verification-design.md`](../specs/2026-07-28-doc-verification-design.md)

## Global Constraints

- **No LLM anywhere.** Not for extraction, drafting, or adjudicating drift.
- **No auto-editing of `data/*.json`.** Checks report; humans write the pack.
- **No new scenarios.** Coverage gaps are reported only; filling them is sub-project B.
- **No credentials, no live Partner Center calls.** Unchanged.
- **Imports use explicit `.js` extensions** (`module: NodeNext`), and type-only imports must be written `import type` (`verbatimModuleSyntax`).
- **`noUncheckedIndexedAccess` is on.** Every array/record index yields `T | undefined`; handle with `?? fallback`. Do **not** use `!` — Biome's recommended preset bans non-null assertions.
- **Coverage thresholds in `vitest.config.ts` (statements 80 / branches 65 / functions 73 / lines 84) may be raised, never lowered.** `coverage.include` is `src/**/*.ts`, so every new file under `src/docfacts/` is measured.
- **Biome's formatter is disabled**; match the surrounding compact style (double quotes, semicolons, single-line guard clauses).
- **`verification/` must stay out of `package.json`'s `files` array** so the snapshot is never published to npm.
- **Coverage gaps are `info`, never `error`.** 247 uncovered pages exist today; making them failures would leave CI permanently red.

---

### Task 1: HTML utilities

The extractor's fragile part is HTML parsing. Isolate it first, with its own tests, before anything depends on it.

**Files:**
- Create: `src/docfacts/html.ts`
- Test: `test/docfacts-html.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `metaContent(html: string, name: string): string | null`, `text(html: string): string`, `sectionAfter(html: string, headingId: string): string | null`, `parseTables(html: string): Table[]` where `interface Table { headers: string[]; rows: string[][] }`.

- [ ] **Step 1: Write the failing test**

Create `test/docfacts-html.test.ts`:

```ts
import { test, expect } from "vitest";
import { metaContent, text, sectionAfter, parseTables } from "../src/docfacts/html.js";

test("metaContent reads a meta tag by name and returns null when absent", () => {
  const html = '<meta name="document_id" content="abc-123" />\n<meta name="ms.date" content="2024-03-20T00:00:00Z" />';
  expect(metaContent(html, "document_id")).toBe("abc-123");
  expect(metaContent(html, "ms.date")).toBe("2024-03-20T00:00:00Z");
  expect(metaContent(html, "missing")).toBeNull();
});

test("text strips tags, decodes entities, and collapses whitespace", () => {
  expect(text("<td><strong>POST</strong></td>")).toBe("POST");
  expect(text("<td>a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39;</td>")).toBe("a & b <c> \"d\" 'e'");
  expect(text("<p>one\n   two</p>")).toBe("one two");
});

test("sectionAfter returns the slice from a heading to the next heading", () => {
  const html = '<h3 id="request-syntax">Request syntax</h3><table>T1</table><h3 id="request-headers">Request headers</h3><table>T2</table>';
  const section = sectionAfter(html, "request-syntax");
  expect(section).toContain("T1");
  expect(section).not.toContain("T2");
  expect(sectionAfter(html, "nope")).toBeNull();
});

test("parseTables splits header row from body rows", () => {
  const html = "<table><thead><tr><th>Method</th><th>Request URI</th></tr></thead>"
    + "<tbody><tr><td><strong>POST</strong></td><td>{baseURL}/v1/customers HTTP/1.1</td></tr></tbody></table>";
  const tables = parseTables(html);
  expect(tables).toHaveLength(1);
  expect(tables[0]?.headers).toEqual(["Method", "Request URI"]);
  expect(tables[0]?.rows).toEqual([["POST", "{baseURL}/v1/customers HTTP/1.1"]]);
});

test("parseTables returns every table in the slice", () => {
  expect(parseTables("<table><tr><th>A</th></tr></table><table><tr><th>B</th></tr></table>")).toHaveLength(2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/docfacts-html.test.ts`
Expected: FAIL — `Failed to resolve import "../src/docfacts/html.js"`

- [ ] **Step 3: Write the implementation**

Create `src/docfacts/html.ts`:

```ts
// Minimal HTML readers for Microsoft Learn pages. Regex rather than a DOM
// parser on purpose: Learn's markup is machine-generated and stable, and a
// parser dependency would be the only runtime addition in this repo.

export interface Table {
  headers: string[];
  rows: string[][];
}

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: "\"", "#39": "'", apos: "'", nbsp: " ",
};

function decodeEntities(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g, (whole, name: string) => ENTITIES[name] ?? whole);
}

/** Visible text of an HTML fragment: tags stripped, entities decoded, whitespace collapsed. */
export function text(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

/** The `content` of `<meta name="...">`, or null when the tag is absent. */
export function metaContent(html: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(new RegExp(`<meta\\s+name="${escaped}"\\s+content="([^"]*)"`, "i"));
  return match?.[1] ?? null;
}

/**
 * The slice of `html` starting at the heading with `id`, ending before the next
 * heading of any level. Learn nests h2 > h3, so stopping at any heading keeps a
 * section from swallowing its siblings.
 */
export function sectionAfter(html: string, headingId: string): string | null {
  const escaped = headingId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const start = html.search(new RegExp(`<h[1-6][^>]*id="${escaped}"`, "i"));
  if (start < 0) return null;
  const rest = html.slice(start);
  const next = rest.slice(1).search(/<h[1-6][\s>]/i);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

/** Every `<table>` in the fragment, first row treated as the header row. */
export function parseTables(html: string): Table[] {
  return [...html.matchAll(/<table[\s\S]*?<\/table>/gi)].map((table) => {
    const rows = [...(table[0] ?? "").matchAll(/<tr[\s\S]*?<\/tr>/gi)]
      .map((row) => [...(row[0] ?? "").matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => text(cell[1] ?? "")));
    const [headers, ...body] = rows;
    return { headers: headers ?? [], rows: body };
  });
}
```

- [ ] **Step 4: Run tests and lint**

Run: `npx vitest run test/docfacts-html.test.ts && npm run lint && npm run build`
Expected: 5 tests PASS, lint clean, build clean.

- [ ] **Step 5: Commit**

```bash
git add src/docfacts/html.ts test/docfacts-html.test.ts
git commit -m "feat(docfacts): add HTML readers for Learn pages"
```

---

### Task 2: DocFacts type and Partner Center extraction

**Files:**
- Create: `src/docfacts/types.ts`, `src/docfacts/extract.ts`
- Create: `test/fixtures/docs/pc-endpoint.html`, `test/fixtures/docs/pc-conceptual.html`, `test/fixtures/docs/malformed.html`
- Test: `test/docfacts-extract.test.ts`

**Interfaces:**
- Consumes: `metaContent`, `text`, `sectionAfter`, `parseTables` from Task 1.
- Produces: `EXTRACTOR_VERSION: number`, `DocFactsSchema`, `type DocFacts`, `SnapshotSchema`, `type Snapshot`, `normalizeUri(raw: string): string`, `extractDocFacts(url: string, finalUrl: string, html: string): DocFacts`.

- [ ] **Step 1: Capture the fixtures**

Real pages, so the tests assert against markup Learn actually serves:

```bash
mkdir -p test/fixtures/docs
curl -sL "https://learn.microsoft.com/partner-center/developer/create-a-customer" -o test/fixtures/docs/pc-endpoint.html
curl -sL "https://learn.microsoft.com/partner-center/developer/enable-secure-app-model" -o test/fixtures/docs/pc-conceptual.html
printf '<html><head><title>nope</title></head><body><p>no metadata, no heading</p></body></html>\n' > test/fixtures/docs/malformed.html
```

Confirm the captures are real articles before continuing:

```bash
grep -c 'name="gitcommit"' test/fixtures/docs/pc-endpoint.html test/fixtures/docs/pc-conceptual.html
```

Expected: `1` for both. If either is `0` the capture failed (redirect to a login or error page) — re-run before proceeding.

- [ ] **Step 2: Write the failing test**

Create `test/docfacts-extract.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { test, expect } from "vitest";
import { extractDocFacts, normalizeUri } from "../src/docfacts/extract.js";
import { EXTRACTOR_VERSION } from "../src/docfacts/types.js";

const fixture = (name: string) => readFileSync(`test/fixtures/docs/${name}`, "utf8");

const PC_URL = "https://learn.microsoft.com/partner-center/developer/create-a-customer";
const PC_FINAL = "https://learn.microsoft.com/en-us/partner-center/developer/create-a-customer";

test("normalizeUri strips the baseURL placeholder and the protocol token", () => {
  expect(normalizeUri("{baseURL} /v1/customers HTTP/1.1")).toBe("/v1/customers");
  expect(normalizeUri("{baseURL}/v1/customers/{customer-id}/carts HTTP/1.1")).toBe("/v1/customers/{customer-id}/carts");
  expect(normalizeUri("/v1/customers")).toBe("/v1/customers");
});

test("a Partner Center endpoint page yields identity, request syntax and body fields", () => {
  const facts = extractDocFacts(PC_URL, PC_FINAL, fixture("pc-endpoint.html"));
  expect(facts.url).toBe(PC_URL);
  expect(facts.finalUrl).toBe(PC_FINAL);
  expect(facts.template).toBe("partner-center");
  expect(facts.sourceRepo).toBe("MicrosoftDocs/partner-center-pr");
  expect(facts.sourceSha).toMatch(/^[0-9a-f]{40}$/);
  expect(facts.sourcePath).toBe("partner-center/developer/create-a-customer.md");
  expect(facts.documentId).toMatch(/^[0-9a-f-]{36}$/);
  expect(facts.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(facts.requestSyntax).toEqual({ method: "POST", uri: "/v1/customers" });
  expect(facts.isEndpointPage).toBe(true);
  expect(facts.bodyFields.map((f) => f.name)).toContain("BillingProfile");
  expect(facts.extractionError).toBeNull();
  expect(facts.extractorVersion).toBe(EXTRACTOR_VERSION);
});

test("a page that links to the shared headers article yields no header names", () => {
  // create-a-customer's Request headers section is a bullet list pointing at
  // the shared "Partner Center REST headers" page, not a table. Absent headers
  // must read as "not tabulated", never as an extraction failure.
  const facts = extractDocFacts(PC_URL, PC_FINAL, fixture("pc-endpoint.html"));
  expect(facts.headerNames).toEqual([]);
  expect(facts.extractionError).toBeNull();
});

test("a conceptual page extracts identity but is not an endpoint page", () => {
  const url = "https://learn.microsoft.com/partner-center/developer/enable-secure-app-model";
  const facts = extractDocFacts(url, url, fixture("pc-conceptual.html"));
  expect(facts.template).toBe("partner-center");
  expect(facts.sourceSha).toMatch(/^[0-9a-f]{40}$/);
  expect(facts.requestSyntax).toBeNull();
  expect(facts.isEndpointPage).toBe(false);
  expect(facts.extractionError).toBeNull();
});

test("a page without Learn metadata reports an extraction error rather than empty facts", () => {
  const url = "https://learn.microsoft.com/partner-center/developer/whatever";
  const facts = extractDocFacts(url, url, fixture("malformed.html"));
  expect(facts.extractionError).toContain("gitcommit");
  expect(facts.extractionError).toContain("document_id");
  expect(facts.sourceSha).toBeNull();
  expect(facts.isEndpointPage).toBe(false);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/docfacts-extract.test.ts`
Expected: FAIL — `Failed to resolve import "../src/docfacts/extract.js"`

- [ ] **Step 4: Write the type module**

Create `src/docfacts/types.ts`:

```ts
import { z } from "zod";

/**
 * Bump when extraction logic changes. Every snapshot record changes with it,
 * so the version turns that churn into one deliberate re-baseline instead of
 * a few hundred phantom drift findings.
 */
export const EXTRACTOR_VERSION = 1;

export const DocFactsSchema = z.object({
  url: z.string().url(),
  finalUrl: z.string().url(),
  template: z.enum(["partner-center", "graph", "unknown"]),
  documentId: z.union([z.string(), z.null()]),
  sourceRepo: z.union([z.string(), z.null()]),
  sourceSha: z.union([z.string(), z.null()]),
  sourcePath: z.union([z.string(), z.null()]),
  msDate: z.union([z.string(), z.null()]),
  updatedAt: z.union([z.string(), z.null()]),
  title: z.union([z.string(), z.null()]),
  requestSyntax: z.union([z.object({ method: z.string(), uri: z.string() }), z.null()]),
  headerNames: z.array(z.string()),
  bodyFields: z.array(z.object({ name: z.string(), type: z.string() })),
  isEndpointPage: z.boolean(),
  extractionError: z.union([z.string(), z.null()]),
  extractorVersion: z.number(),
});

export const SnapshotSchema = z.object({
  version: z.string(),
  extractorVersion: z.number(),
  tocHrefs: z.array(z.string()),
  pages: z.record(z.string(), DocFactsSchema),
});

export type DocFacts = z.infer<typeof DocFactsSchema>;
export type Snapshot = z.infer<typeof SnapshotSchema>;
```

- [ ] **Step 5: Write the extractor**

Create `src/docfacts/extract.ts`:

```ts
import { metaContent, parseTables, sectionAfter, text } from "./html.js";
import { EXTRACTOR_VERSION, type DocFacts } from "./types.js";

const METHODS = /^(GET|POST|PUT|PATCH|DELETE|HEAD)$/;

/** `{baseURL} /v1/customers HTTP/1.1` -> `/v1/customers`. */
export function normalizeUri(raw: string): string {
  return raw
    .replace(/\{baseURL\}/gi, "")
    .replace(/\s*HTTP\/\d(\.\d)?\s*$/i, "")
    .replace(/\s+/g, "")
    .trim();
}

interface GitCommit {
  repo: string | null;
  sha: string | null;
  path: string | null;
}

// <meta name="gitcommit"> pins the source markdown to an exact commit. This is
// the drift signal: original_content_git_url points at `live` and so never
// changes, while this SHA moves whenever the source page is edited.
function gitCommit(html: string): GitCommit {
  const raw = metaContent(html, "gitcommit");
  const match = raw?.match(/github\.com\/([^/]+\/[^/]+)\/blob\/([0-9a-f]{40})\/(.+?)(?:[?#]|$)/i);
  if (!match) return { repo: null, sha: null, path: null };
  return { repo: match[1] ?? null, sha: match[2] ?? null, path: match[3] ?? null };
}

// Family is decided by where the doc lives, not by which sections it has. A
// conceptual Partner Center page is still a Partner Center page; only its
// requestSyntax is absent.
function detectTemplate(url: string, repo: string | null): DocFacts["template"] {
  const hay = (repo ?? "") + " " + url;
  if (/microsoft-graph-docs|learn\.microsoft\.com\/(en-us\/)?graph\//i.test(hay)) return "graph";
  if (/partner-center/i.test(hay)) return "partner-center";
  return "unknown";
}

function title(html: string): string | null {
  const match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const value = text(match?.[1] ?? "");
  return value === "" ? null : value;
}

function partnerCenterRequestSyntax(html: string): DocFacts["requestSyntax"] {
  const section = sectionAfter(html, "request-syntax");
  if (section === null) return null;
  const table = parseTables(section)[0];
  if (!table || (table.headers[0] ?? "").toLowerCase() !== "method") return null;
  const row = table.rows[0];
  if (!row) return null;
  const method = (row[0] ?? "").toUpperCase();
  const uri = normalizeUri(row[1] ?? "");
  if (!METHODS.test(method) || uri === "") return null;
  return { method, uri };
}

function headerNames(html: string): string[] {
  const section = sectionAfter(html, "request-headers");
  if (section === null) return [];
  const table = parseTables(section)[0];
  if (!table) return [];
  const first = (table.headers[0] ?? "").toLowerCase();
  if (first !== "header" && first !== "name") return [];
  return table.rows.map((row) => row[0] ?? "").filter((name) => name !== "");
}

function bodyFields(html: string): DocFacts["bodyFields"] {
  const section = sectionAfter(html, "request-body");
  if (section === null) return [];
  const fields: DocFacts["bodyFields"] = [];
  for (const table of parseTables(section)) {
    if ((table.headers[0] ?? "").toLowerCase() !== "name") continue;
    for (const row of table.rows) {
      const name = row[0] ?? "";
      if (name !== "") fields.push({ name, type: row[1] ?? "" });
    }
  }
  return fields;
}

export function extractDocFacts(url: string, finalUrl: string, html: string): DocFacts {
  const { repo, sha, path } = gitCommit(html);
  const template = detectTemplate(url, repo);
  const pageTitle = title(html);
  const documentId = metaContent(html, "document_id");

  // Missing identity means we did not receive a Learn article at all (an error
  // page, a login redirect, or a template change). Recording that as its own
  // event is what keeps field verification from silently passing on nothing.
  const problems: string[] = [];
  if (sha === null) problems.push("no gitcommit meta");
  if (documentId === null) problems.push("no document_id meta");
  if (pageTitle === null) problems.push("no <h1>");

  const requestSyntax = template === "partner-center" ? partnerCenterRequestSyntax(html) : null;

  return {
    url,
    finalUrl,
    template,
    documentId,
    sourceRepo: repo,
    sourceSha: sha,
    sourcePath: path,
    msDate: metaContent(html, "ms.date"),
    updatedAt: metaContent(html, "updated_at"),
    title: pageTitle,
    requestSyntax,
    headerNames: headerNames(html),
    bodyFields: bodyFields(html),
    isEndpointPage: requestSyntax !== null,
    extractionError: problems.length > 0 ? problems.join("; ") : null,
    extractorVersion: EXTRACTOR_VERSION,
  };
}
```

- [ ] **Step 6: Run tests and lint**

Run: `npx vitest run test/docfacts-extract.test.ts && npm run lint && npm run build`
Expected: 5 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/docfacts/types.ts src/docfacts/extract.ts test/docfacts-extract.test.ts test/fixtures/docs/
git commit -m "feat(docfacts): extract DocFacts from Partner Center Learn pages"
```

---

### Task 3: Graph template support

Graph pages carry the same metadata but publish their route as an `http` code block under `HTTP request`, and tabulate headers as `Header | Value`.

**Files:**
- Modify: `src/docfacts/extract.ts`
- Create: `test/fixtures/docs/graph-endpoint.html`
- Modify: `test/docfacts-extract.test.ts`

**Interfaces:**
- Consumes: everything from Task 2.
- Produces: no new exports; `extractDocFacts` now returns a non-null `requestSyntax` for `template === "graph"` pages.

- [ ] **Step 1: Capture the fixture**

```bash
curl -sL "https://learn.microsoft.com/graph/api/user-post-users" -o test/fixtures/docs/graph-endpoint.html
grep -c 'id="http-request"' test/fixtures/docs/graph-endpoint.html
```

Expected: `1`.

- [ ] **Step 2: Write the failing test**

Append to `test/docfacts-extract.test.ts`:

```ts
test("a Graph endpoint page yields its route and tabulated headers", () => {
  const url = "https://learn.microsoft.com/graph/api/user-post-users";
  const facts = extractDocFacts(url, url, fixture("graph-endpoint.html"));
  expect(facts.template).toBe("graph");
  expect(facts.sourceRepo).toBe("microsoftgraph/microsoft-graph-docs");
  expect(facts.sourceSha).toMatch(/^[0-9a-f]{40}$/);
  expect(facts.requestSyntax).toEqual({ method: "POST", uri: "/users" });
  expect(facts.isEndpointPage).toBe(true);
  expect(facts.headerNames).toContain("Authorization");
  expect(facts.extractionError).toBeNull();
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/docfacts-extract.test.ts -t "Graph endpoint"`
Expected: FAIL — `expected null to equal { method: 'POST', uri: '/users' }`

- [ ] **Step 4: Implement the Graph reader**

In `src/docfacts/extract.ts`, add below `partnerCenterRequestSyntax`:

```ts
// Graph publishes the route as an http code block. Pages that document several
// routes list them one per line; the first is the canonical one, which is what
// the pack records.
function graphRequestSyntax(html: string): DocFacts["requestSyntax"] {
  const section = sectionAfter(html, "http-request");
  if (section === null) return null;
  const block = section.match(/<pre><code[^>]*>([\s\S]*?)<\/code><\/pre>/i);
  if (!block) return null;
  const firstLine = text(block[1] ?? "").split(/\s+/);
  const method = (firstLine[0] ?? "").toUpperCase();
  const uri = firstLine[1] ?? "";
  if (!METHODS.test(method) || !uri.startsWith("/")) return null;
  return { method, uri };
}
```

Then replace the `requestSyntax` assignment in `extractDocFacts`:

```ts
  const requestSyntax = template === "graph"
    ? graphRequestSyntax(html)
    : template === "partner-center"
      ? partnerCenterRequestSyntax(html)
      : null;
```

- [ ] **Step 5: Run tests and lint**

Run: `npx vitest run test/docfacts-extract.test.ts && npm run lint && npm run build`
Expected: 6 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/docfacts/extract.ts test/docfacts-extract.test.ts test/fixtures/docs/graph-endpoint.html
git commit -m "feat(docfacts): extract request syntax from Microsoft Graph pages"
```

---

### Task 4: Snapshot read/write

**Files:**
- Create: `src/docfacts/snapshot.ts`
- Test: `test/docfacts-snapshot.test.ts`

**Interfaces:**
- Consumes: `SnapshotSchema`, `type Snapshot`, `type DocFacts` from Task 2.
- Produces: `SNAPSHOT_PATH: string`, `readSnapshot(path?: string): Snapshot`, `writeSnapshot(snapshot: Snapshot, path?: string): void`, `emptySnapshot(version: string): Snapshot`.

- [ ] **Step 1: Write the failing test**

Create `test/docfacts-snapshot.test.ts`:

```ts
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "vitest";
import { emptySnapshot, readSnapshot, writeSnapshot } from "../src/docfacts/snapshot.js";
import { EXTRACTOR_VERSION, type DocFacts } from "../src/docfacts/types.js";

const dir = () => mkdtempSync(join(tmpdir(), "docfacts-"));

function facts(url: string): DocFacts {
  return {
    url, finalUrl: url, template: "partner-center",
    documentId: "doc-1", sourceRepo: "MicrosoftDocs/partner-center-pr",
    sourceSha: "a".repeat(40), sourcePath: "partner-center/developer/x.md",
    msDate: "2024-03-20T00:00:00Z", updatedAt: "2025-03-12T22:01:00Z", title: "X",
    requestSyntax: { method: "GET", uri: "/v1/customers" },
    headerNames: [], bodyFields: [], isEndpointPage: true,
    extractionError: null, extractorVersion: EXTRACTOR_VERSION,
  };
}

test("a written snapshot round-trips", () => {
  const path = join(dir(), "doc-facts.json");
  const snap = emptySnapshot("2026-07");
  snap.tocHrefs = ["developer/create-a-customer"];
  snap.pages["https://learn.microsoft.com/a"] = facts("https://learn.microsoft.com/a");
  writeSnapshot(snap, path);
  expect(readSnapshot(path)).toEqual(snap);
});

test("writeSnapshot sorts keys so diffs stay readable", () => {
  const path = join(dir(), "doc-facts.json");
  const snap = emptySnapshot("2026-07");
  snap.tocHrefs = ["developer/b", "developer/a"];
  snap.pages["https://learn.microsoft.com/z"] = facts("https://learn.microsoft.com/z");
  snap.pages["https://learn.microsoft.com/a"] = facts("https://learn.microsoft.com/a");
  writeSnapshot(snap, path);
  const raw = readFileSync(path, "utf8");
  expect(raw.indexOf("learn.microsoft.com/a")).toBeLessThan(raw.indexOf("learn.microsoft.com/z"));
  expect(readSnapshot(path).tocHrefs).toEqual(["developer/a", "developer/b"]);
  expect(raw.endsWith("\n")).toBe(true);
});

test("readSnapshot rejects a malformed file with an actionable message", () => {
  const path = join(dir(), "doc-facts.json");
  writeFileSync(path, JSON.stringify({ version: "2026-07" }));
  expect(() => readSnapshot(path)).toThrow(/invalid/i);
});

test("readSnapshot explains how to create a missing snapshot", () => {
  expect(() => readSnapshot(join(dir(), "absent.json"))).toThrow(/docfacts:refresh/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/docfacts-snapshot.test.ts`
Expected: FAIL — `Failed to resolve import "../src/docfacts/snapshot.js"`

- [ ] **Step 3: Write the implementation**

Create `src/docfacts/snapshot.ts`:

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { EXTRACTOR_VERSION, SnapshotSchema, type Snapshot } from "./types.js";

// Deliberately outside data/: package.json's `files` publishes data/ to npm,
// and this is build-time tooling data that no consumer of the package needs.
export const SNAPSHOT_PATH = "verification/doc-facts.json";

export function emptySnapshot(version: string): Snapshot {
  return { version, extractorVersion: EXTRACTOR_VERSION, tocHrefs: [], pages: {} };
}

export function readSnapshot(path: string = SNAPSHOT_PATH): Snapshot {
  if (!existsSync(path)) {
    throw new Error(`${path}: missing. Run \`npm run docfacts:refresh\` to create it.`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new Error(`${path}: cannot parse (${(e as Error).message})`);
  }
  const result = SnapshotSchema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    const detail = issue ? `${issue.path.join(".")}: ${issue.message}` : result.error.message;
    throw new Error(`${path}: invalid (${detail})`);
  }
  return result.data;
}

export function writeSnapshot(snapshot: Snapshot, path: string = SNAPSHOT_PATH): void {
  const pages: Snapshot["pages"] = {};
  for (const url of Object.keys(snapshot.pages).sort()) {
    const facts = snapshot.pages[url];
    if (facts) pages[url] = facts;
  }
  const sorted: Snapshot = { ...snapshot, tocHrefs: [...snapshot.tocHrefs].sort(), pages };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(sorted, null, 2) + "\n");
}
```

- [ ] **Step 4: Run tests and lint**

Run: `npx vitest run test/docfacts-snapshot.test.ts && npm run lint && npm run build`
Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/docfacts/snapshot.ts test/docfacts-snapshot.test.ts
git commit -m "feat(docfacts): read and write the verification snapshot"
```

---

### Task 5: Fetching, and the first snapshot

The only module that touches the network. Kept thin so the checks above it stay pure.

**Files:**
- Create: `src/docfacts/fetch.ts`, `scripts/docfacts-refresh.mjs`
- Modify: `package.json` (add the `docfacts:refresh` script)
- Test: `test/docfacts-fetch.test.ts`
- Create (generated, committed): `verification/doc-facts.json`

**Interfaces:**
- Consumes: `extractDocFacts` (Task 2/3), `emptySnapshot`/`writeSnapshot` (Task 4).
- Produces: `interface PageFetch { url: string; finalUrl: string; status: number; html: string | null; error: string | null }`, `fetchPage(url: string, timeoutMs?: number): Promise<PageFetch>`, `fetchAll(urls: string[], concurrency?: number, timeoutMs?: number): Promise<PageFetch[]>`.

- [ ] **Step 1: Write the failing test**

Drives a real local server on port 0, mirroring `test/http.test.ts`'s approach — no network, no mocking.

Create `test/docfacts-fetch.test.ts`:

```ts
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { test, expect } from "vitest";
import { fetchAll, fetchPage } from "../src/docfacts/fetch.js";

async function withServer(handler: (path: string) => { status: number; body: string }, run: (base: string) => Promise<void>) {
  const server: Server = createServer((req, res) => {
    const { status, body } = handler(req.url ?? "/");
    res.writeHead(status, { "content-type": "text/html" });
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("fetchPage returns the body and status of a page", async () => {
  await withServer(() => ({ status: 200, body: "<h1>ok</h1>" }), async (base) => {
    const result = await fetchPage(`${base}/page`);
    expect(result.status).toBe(200);
    expect(result.html).toBe("<h1>ok</h1>");
    expect(result.error).toBeNull();
  });
});

test("fetchPage reports a non-200 without a body", async () => {
  await withServer(() => ({ status: 404, body: "gone" }), async (base) => {
    const result = await fetchPage(`${base}/missing`);
    expect(result.status).toBe(404);
    expect(result.html).toBeNull();
  });
});

test("fetchPage reports a transport failure as an error, not a throw", async () => {
  const result = await fetchPage("http://127.0.0.1:1/nothing", 500);
  expect(result.status).toBe(0);
  expect(result.error).not.toBeNull();
  expect(result.html).toBeNull();
});

test("fetchAll preserves input order under concurrency", async () => {
  await withServer((path) => ({ status: 200, body: `<h1>${path}</h1>` }), async (base) => {
    const urls = ["/a", "/b", "/c", "/d", "/e"].map((p) => base + p);
    const results = await fetchAll(urls, 2);
    expect(results.map((r) => r.url)).toEqual(urls);
    expect(results[2]?.html).toBe("<h1>/c</h1>");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/docfacts-fetch.test.ts`
Expected: FAIL — `Failed to resolve import "../src/docfacts/fetch.js"`

- [ ] **Step 3: Write the implementation**

Create `src/docfacts/fetch.ts`:

```ts
export interface PageFetch {
  url: string;
  finalUrl: string;
  status: number;
  html: string | null;
  error: string | null;
}

const UA = "partner-center-mcp-doccheck/2.0 (+https://github.com/tunahanaliozturk/partner-center-mcp)";

export async function fetchPage(url: string, timeoutMs = 15000): Promise<PageFetch> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": UA, accept: "text/html" },
    });
    const ok = res.status >= 200 && res.status < 400;
    return {
      url,
      finalUrl: res.url === "" ? url : res.url,
      status: res.status,
      html: ok ? await res.text() : null,
      error: null,
    };
  } catch (e) {
    return { url, finalUrl: url, status: 0, html: null, error: String((e as Error)?.message ?? e) };
  } finally {
    clearTimeout(timer);
  }
}

/** Concurrency-limited fetch that keeps results in input order. */
export async function fetchAll(urls: string[], concurrency = 6, timeoutMs = 15000): Promise<PageFetch[]> {
  const out: PageFetch[] = new Array(urls.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, urls.length) }, async () => {
    while (next < urls.length) {
      const index = next++;
      const url = urls[index];
      if (url === undefined) continue;
      out[index] = await fetchPage(url, timeoutMs);
    }
  });
  await Promise.all(workers);
  return out;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/docfacts-fetch.test.ts && npm run lint && npm run build`
Expected: 4 tests PASS.

- [ ] **Step 5: Write the refresh CLI**

Create `scripts/docfacts-refresh.mjs`:

```js
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
```

Add to `package.json` `scripts`:

```json
"docfacts:refresh": "node scripts/docfacts-refresh.mjs",
```

- [ ] **Step 6: Generate the first snapshot**

Run: `npm run build && npm run docfacts:refresh`
Expected: `wrote verification/doc-facts.json: 98 pages, 0 unreachable, 0 with extraction errors`

98, not 95: the 95 unique scenario `docUrl`s plus three that only `errors.json` references —
`deprecate-azure-active-directory-graph-token`, `error-codes`, and
`entra/identity-platform/reference-error-codes`. The last is a third doc family, so
`detectTemplate` returns `"unknown"` for it and its `requestSyntax` is `null`. That is correct: it
is a reference page, not an endpoint. It must still extract identity cleanly — an `extractionError`
on it would be a real finding.

If any page reports an extraction error, that is a real finding about that page — investigate before committing. A handful of unreachable pages means the doc links are already dead and belong in a separate fix.

- [ ] **Step 7: Confirm the snapshot is not published**

Run: `npm pack --dry-run 2>&1 | grep -c verification` (expected: `0`), then `git check-ignore verification/doc-facts.json; echo "exit=$?"` (expected: `exit=1`, i.e. the file is *not* ignored and will be committed).

- [ ] **Step 8: Commit — implementation and data separately**

```bash
git add src/docfacts/fetch.ts test/docfacts-fetch.test.ts scripts/docfacts-refresh.mjs package.json
git commit -m "feat(docfacts): fetch Learn pages and write the first snapshot"
git add verification/doc-facts.json
git commit -m "chore(docfacts): baseline the verification snapshot"
```

---

### Task 6: Field verification

**Files:**
- Create: `src/docfacts/findings.ts`, `src/docfacts/checks/fields.ts`
- Test: `test/docfacts-fields.test.ts`

**Interfaces:**
- Consumes: `type Snapshot`, `type DocFacts` (Task 2); `type Scenario` from `src/knowledge/schema.js`.
- Produces: `interface Finding { kind: string; severity: "error" | "warning" | "info"; ref: string; message: string; detail?: string }`, `hasErrors(findings: Finding[]): boolean`, `pathsMatch(scenarioPath: string, docUri: string): boolean`, `checkFields(snapshot: Snapshot, scenarios: Scenario[]): Finding[]`.

- [ ] **Step 1: Write the failing test**

Create `test/docfacts-fields.test.ts`:

```ts
import { test, expect } from "vitest";
import { checkFields, pathsMatch } from "../src/docfacts/checks/fields.js";
import { emptySnapshot } from "../src/docfacts/snapshot.js";
import { EXTRACTOR_VERSION, type DocFacts, type Snapshot } from "../src/docfacts/types.js";
import type { Scenario } from "../src/knowledge/schema.js";

const URL_A = "https://learn.microsoft.com/partner-center/developer/a";

function facts(over: Partial<DocFacts> = {}): DocFacts {
  return {
    url: URL_A, finalUrl: URL_A, template: "partner-center",
    documentId: "d1", sourceRepo: "MicrosoftDocs/partner-center-pr",
    sourceSha: "a".repeat(40), sourcePath: "p.md",
    msDate: null, updatedAt: null, title: "A",
    requestSyntax: { method: "GET", uri: "/v1/customers/{customer-id}/subscriptions" },
    headerNames: [], bodyFields: [], isEndpointPage: true,
    extractionError: null, extractorVersion: EXTRACTOR_VERSION, ...over,
  };
}

function scenario(over: Partial<Scenario> = {}): Scenario {
  return {
    id: "s1", area: "customers", title: "A", method: "GET",
    path: "/v1/customers/{customer-id}/subscriptions", authType: "app+user",
    headers: [], requestShape: null, responseShape: null,
    examples: { curl: "", csharp: "", typescript: "" },
    gotchas: [], docUrl: URL_A, lastVerified: "2026-07-01", ...over,
  } as Scenario;
}

function snapshotWith(f: DocFacts): Snapshot {
  const snap = emptySnapshot("2026-07");
  snap.pages[f.url] = f;
  return snap;
}

test("pathsMatch treats placeholders as wildcards but compares literals", () => {
  expect(pathsMatch("/v1/customers/{customer-id}/carts", "/v1/customers/{customer_id}/carts")).toBe(true);
  expect(pathsMatch("/v1/customers/{id}/carts", "/v1/customers/{id}/orders")).toBe(false);
  expect(pathsMatch("/v1/customers", "/v1/customers/{id}")).toBe(false);
  expect(pathsMatch("/v1/customers?size=2", "/v1/customers")).toBe(true);
});

test("a matching scenario produces no findings", () => {
  expect(checkFields(snapshotWith(facts()), [scenario()])).toEqual([]);
});

test("a wrong method is an error naming both sides", () => {
  const findings = checkFields(snapshotWith(facts()), [scenario({ method: "POST" })]);
  expect(findings).toHaveLength(1);
  expect(findings[0]?.severity).toBe("error");
  expect(findings[0]?.ref).toBe("s1");
  expect(findings[0]?.message).toContain("POST");
  expect(findings[0]?.message).toContain("GET");
});

test("a wrong path is an error", () => {
  const findings = checkFields(snapshotWith(facts()), [scenario({ path: "/v1/customers/{customer-id}/orders" })]);
  expect(findings.some((f) => f.severity === "error" && f.kind === "field-mismatch")).toBe(true);
});

test("a documented header the scenario omits is a warning, not an error", () => {
  const findings = checkFields(snapshotWith(facts({ headerNames: ["Authorization", "MS-RequestId"] })), [scenario()]);
  expect(findings.every((f) => f.severity === "warning")).toBe(true);
  expect(findings[0]?.message).toContain("MS-RequestId");
});

test("an unreadable page is skipped with a reason, never counted as passing", () => {
  const findings = checkFields(snapshotWith(facts({ extractionError: "no gitcommit meta", requestSyntax: null })), [scenario()]);
  expect(findings).toHaveLength(1);
  expect(findings[0]?.kind).toBe("field-skipped");
  expect(findings[0]?.message).toContain("no gitcommit meta");
});

test("a conceptual page is skipped, and a scenario missing from the snapshot is reported", () => {
  const skipped = checkFields(snapshotWith(facts({ requestSyntax: null, isEndpointPage: false })), [scenario()]);
  expect(skipped[0]?.kind).toBe("field-skipped");
  const absent = checkFields(emptySnapshot("2026-07"), [scenario()]);
  expect(absent[0]?.kind).toBe("unverified");
  expect(absent[0]?.severity).toBe("warning");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/docfacts-fields.test.ts`
Expected: FAIL — `Failed to resolve import "../src/docfacts/checks/fields.js"`

- [ ] **Step 3: Write the findings module**

Create `src/docfacts/findings.ts`:

```ts
export interface Finding {
  kind: string;
  severity: "error" | "warning" | "info";
  ref: string;
  message: string;
  detail?: string;
}

export function hasErrors(findings: Finding[]): boolean {
  return findings.some((f) => f.severity === "error");
}
```

- [ ] **Step 4: Write the check**

Create `src/docfacts/checks/fields.ts`:

```ts
import type { Scenario } from "../../knowledge/schema.js";
import type { Finding } from "../findings.js";
import type { Snapshot } from "../types.js";

function segments(path: string): string[] {
  return (path.split("?")[0] ?? "").split("/").filter((s) => s !== "");
}

/**
 * Placeholder segments are wildcards: the docs and the pack disagree on
 * spelling (`{customer-id}` vs `{customer_id}`) often enough that comparing
 * them would only produce noise. Literal segments and segment count are
 * compared strictly, which is where a genuinely changed route shows up.
 */
export function pathsMatch(scenarioPath: string, docUri: string): boolean {
  const left = segments(scenarioPath);
  const right = segments(docUri);
  if (left.length !== right.length) return false;
  return left.every((segment, i) => {
    const other = right[i] ?? "";
    if (segment.startsWith("{") || other.startsWith("{")) return true;
    return segment.toLowerCase() === other.toLowerCase();
  });
}

export function checkFields(snapshot: Snapshot, scenarios: Scenario[]): Finding[] {
  const findings: Finding[] = [];
  for (const scenario of scenarios) {
    const facts = snapshot.pages[scenario.docUrl];
    if (!facts) {
      findings.push({
        kind: "unverified", severity: "warning", ref: scenario.id,
        message: `${scenario.docUrl} is not in the snapshot, so this scenario is never verified.`,
        detail: "Run `npm run docfacts:refresh`.",
      });
      continue;
    }
    if (facts.extractionError !== null) {
      findings.push({
        kind: "field-skipped", severity: "warning", ref: scenario.id,
        message: `skipped: the page could not be read (${facts.extractionError}).`,
      });
      continue;
    }
    if (facts.requestSyntax === null) {
      findings.push({
        kind: "field-skipped", severity: "info", ref: scenario.id,
        message: `skipped: ${facts.url} documents no request syntax (conceptual page or unsupported template).`,
      });
      continue;
    }
    if (scenario.method !== facts.requestSyntax.method) {
      findings.push({
        kind: "field-mismatch", severity: "error", ref: scenario.id,
        message: `method is ${scenario.method} but the docs say ${facts.requestSyntax.method}.`,
        detail: facts.url,
      });
    }
    if (!pathsMatch(scenario.path, facts.requestSyntax.uri)) {
      findings.push({
        kind: "field-mismatch", severity: "error", ref: scenario.id,
        message: `path is ${scenario.path} but the docs say ${facts.requestSyntax.uri}.`,
        detail: facts.url,
      });
    }
    const declared = new Set(scenario.headers.map((h) => h.name.toLowerCase()));
    const undeclared = facts.headerNames.filter((name) => !declared.has(name.toLowerCase()));
    if (undeclared.length > 0) {
      findings.push({
        kind: "field-header", severity: "warning", ref: scenario.id,
        message: `the docs tabulate header(s) the scenario omits: ${undeclared.join(", ")}.`,
        detail: facts.url,
      });
    }
  }
  return findings;
}
```

- [ ] **Step 5: Run tests and lint**

Run: `npx vitest run test/docfacts-fields.test.ts && npm run lint && npm run build`
Expected: 7 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/docfacts/findings.ts src/docfacts/checks/fields.ts test/docfacts-fields.test.ts
git commit -m "feat(docfacts): verify scenario method, path and headers against the docs"
```

---

### Task 7: The offline gate

Wires field verification into every PR. Expect this task to surface real mismatches in the existing pack — fixing them is part of the task, not a follow-up.

**Files:**
- Create: `src/docfacts/report.ts`, `scripts/check-pack.mjs`
- Modify: `package.json`, `.github/workflows/ci.yml`
- Modify: `data/scenarios.json` (only if the check finds genuine mismatches)
- Test: `test/docfacts-report.test.ts`

**Interfaces:**
- Consumes: `type Finding`, `hasErrors` (Task 6).
- Produces: `renderReport(title: string, findings: Finding[], summary: string[]): string`.

- [ ] **Step 1: Write the failing test**

Create `test/docfacts-report.test.ts`:

```ts
import { test, expect } from "vitest";
import { renderReport } from "../src/docfacts/report.js";
import { hasErrors, type Finding } from "../src/docfacts/findings.js";

const findings: Finding[] = [
  { kind: "field-mismatch", severity: "error", ref: "s1", message: "path is /a but the docs say /b.", detail: "https://x/1" },
  { kind: "field-skipped", severity: "info", ref: "s2", message: "skipped: conceptual page." },
];

test("the report groups by kind and orders errors first", () => {
  const md = renderReport("Pack verification", findings, ["96 scenarios checked"]);
  expect(md).toContain("# Pack verification");
  expect(md).toContain("96 scenarios checked");
  expect(md.indexOf("field-mismatch")).toBeLessThan(md.indexOf("field-skipped"));
  expect(md).toContain("`s1`");
  expect(md).toContain("https://x/1");
});

test("an empty finding list renders a clean report", () => {
  expect(renderReport("Pack verification", [], [])).toContain("Nothing to report");
});

test("hasErrors keys off severity alone", () => {
  expect(hasErrors(findings)).toBe(true);
  expect(hasErrors(findings.slice(1))).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/docfacts-report.test.ts`
Expected: FAIL — `Failed to resolve import "../src/docfacts/report.js"`

- [ ] **Step 3: Write the report renderer**

Create `src/docfacts/report.ts`:

```ts
import type { Finding } from "./findings.js";

const RANK: Record<Finding["severity"], number> = { error: 0, warning: 1, info: 2 };
const ICON: Record<Finding["severity"], string> = { error: "❌", warning: "⚠️", info: "ℹ️" };

export function renderReport(title: string, findings: Finding[], summary: string[]): string {
  const lines = [`# ${title}`, ""];
  for (const line of summary) lines.push(`- ${line}`);
  if (summary.length > 0) lines.push("");

  if (findings.length === 0) {
    lines.push("✅ Nothing to report.", "");
    return lines.join("\n");
  }

  const kinds = [...new Set(findings.map((f) => f.kind))].sort((a, b) => {
    const worst = (kind: string) => Math.min(...findings.filter((f) => f.kind === kind).map((f) => RANK[f.severity]));
    return worst(a) - worst(b) || a.localeCompare(b);
  });

  for (const kind of kinds) {
    const group = findings.filter((f) => f.kind === kind);
    lines.push(`## ${kind} (${group.length})`, "");
    for (const finding of group) {
      lines.push(`- ${ICON[finding.severity]} \`${finding.ref}\` — ${finding.message}`);
      if (finding.detail !== undefined) lines.push(`  - ${finding.detail}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
```

- [ ] **Step 4: Run the report tests**

Run: `npx vitest run test/docfacts-report.test.ts`
Expected: 3 tests PASS.

- [ ] **Step 5: Write the offline CLI**

Create `scripts/check-pack.mjs`:

```js
// Offline verification of the knowledge pack against the committed snapshot.
// Runs on every PR: no network, no flakiness. `check-docs` is the networked
// counterpart that refreshes what this reads.
import { writeFileSync } from "node:fs";
import { loadKnowledge } from "../dist/knowledge/load.js";
import { readSnapshot } from "../dist/docfacts/snapshot.js";
import { checkFields } from "../dist/docfacts/checks/fields.js";
import { hasErrors } from "../dist/docfacts/findings.js";
import { renderReport } from "../dist/docfacts/report.js";

const knowledge = loadKnowledge("data");
const snapshot = readSnapshot();
const findings = checkFields(snapshot, knowledge.scenarios);

const errors = findings.filter((f) => f.severity === "error").length;
const skipped = findings.filter((f) => f.kind === "field-skipped").length;
const report = renderReport("Pack verification", findings, [
  `Checked **${knowledge.scenarios.length}** scenarios against **${Object.keys(snapshot.pages).length}** snapshotted pages.`,
  `Field errors: **${errors}**`,
  `Skipped (no comparable request syntax): **${skipped}**`,
]);

writeFileSync("pack-report.md", report);
if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, report, { flag: "a" });
console.log(report);
process.exit(hasErrors(findings) ? 1 : 0);
```

Add to `package.json` `scripts`:

```json
"check-pack": "node scripts/check-pack.mjs",
```

- [ ] **Step 6: Run it and fix what it finds**

Run: `npm run build && npm run check-pack`

Expected on first run: a report listing every mismatch between the pack and the docs. For each `field-mismatch`, open the scenario's `docUrl`, confirm which side is right, and correct `data/scenarios.json` — the docs are authoritative for `method` and `path`. Bump that scenario's `lastVerified` to today while you are in there.

If a mismatch turns out to be an extractor bug rather than a pack error, fix `src/docfacts/extract.ts`, add a regression test to `test/docfacts-extract.test.ts`, and re-run `npm run docfacts:refresh`.

Re-run until: `npm run check-pack` exits 0.

- [ ] **Step 7: Wire it into CI**

In `.github/workflows/ci.yml`, add after the `npm run build` step and before `npm run eval`:

```yaml
      # Offline: verifies data/scenarios.json against the committed doc snapshot.
      # The networked counterpart (check-docs.yml) refreshes that snapshot weekly.
      - run: npm run check-pack
```

Add `pack-report.md` to `.gitignore` (it is a run artifact, like `doc-report.md`):

```bash
grep -q '^pack-report.md$' .gitignore || printf 'pack-report.md\n' >> .gitignore
```

- [ ] **Step 8: Verify the whole suite**

Run: `npm run lint && npm run build && npm run test:coverage && npm run check-pack && npm run eval`
Expected: all green, coverage at or above the configured thresholds.

- [ ] **Step 9: Commit**

```bash
git add src/docfacts/report.ts test/docfacts-report.test.ts scripts/check-pack.mjs package.json .github/workflows/ci.yml .gitignore
git commit -m "feat(docfacts): gate every PR on offline pack verification"
git add data/scenarios.json verification/doc-facts.json
git commit -m "fix(knowledge): correct scenario fields that disagreed with the docs"
```

(Skip the second commit if the first run found no mismatches.)

---

### Task 8: Drift with severity

**Files:**
- Create: `src/docfacts/checks/drift.ts`
- Rewrite: `scripts/check-docs.mjs`
- Modify: `package.json`, `.github/workflows/check-docs.yml`
- Delete: `data/doc-hashes.json`
- Test: `test/docfacts-drift.test.ts`

**Interfaces:**
- Consumes: `type PageFetch` (Task 5), `extractDocFacts` (Task 2), `type Snapshot`/`type DocFacts` (Task 2), `type Finding` (Task 6).
- Produces: `checkDrift(fetched: PageFetch[], snapshot: Snapshot, scenarios: Scenario[], now: Date, staleDays: number): { findings: Finding[]; fresh: Record<string, DocFacts> }`.

- [ ] **Step 1: Write the failing test**

Create `test/docfacts-drift.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { test, expect } from "vitest";
import { checkDrift } from "../src/docfacts/checks/drift.js";
import { extractDocFacts } from "../src/docfacts/extract.js";
import { emptySnapshot } from "../src/docfacts/snapshot.js";
import type { PageFetch } from "../src/docfacts/fetch.js";
import type { Snapshot } from "../src/docfacts/types.js";
import type { Scenario } from "../src/knowledge/schema.js";

const HTML = readFileSync("test/fixtures/docs/pc-endpoint.html", "utf8");
const URL_A = "https://learn.microsoft.com/partner-center/developer/create-a-customer";
const NOW = new Date("2026-07-29T00:00:00Z");

const page = (over: Partial<PageFetch> = {}): PageFetch =>
  ({ url: URL_A, finalUrl: URL_A, status: 200, html: HTML, error: null, ...over });

const scenario = (over: Partial<Scenario> = {}): Scenario => ({
  id: "s1", area: "customers", title: "A", method: "POST", path: "/v1/customers",
  authType: "app+user", headers: [], requestShape: null, responseShape: null,
  examples: { curl: "", csharp: "", typescript: "" }, gotchas: [],
  docUrl: URL_A, lastVerified: "2026-07-01", ...over,
} as Scenario);

function baseline(over: Partial<ReturnType<typeof extractDocFacts>> = {}): Snapshot {
  const snap = emptySnapshot("2026-07");
  snap.pages[URL_A] = { ...extractDocFacts(URL_A, URL_A, HTML), ...over };
  return snap;
}

test("an unchanged page produces no findings", () => {
  const { findings } = checkDrift([page()], baseline(), [scenario()], NOW, 180);
  expect(findings).toEqual([]);
});

test("a changed source commit with identical fields is informational, not an error", () => {
  const { findings } = checkDrift([page()], baseline({ sourceSha: "b".repeat(40) }), [scenario()], NOW, 180);
  expect(findings).toHaveLength(1);
  expect(findings[0]?.kind).toBe("drift-low");
  expect(findings[0]?.severity).toBe("info");
});

test("a changed source commit with a changed request path is an error", () => {
  const snap = baseline({ sourceSha: "b".repeat(40), requestSyntax: { method: "POST", uri: "/v1/old" } });
  const { findings } = checkDrift([page()], snap, [scenario()], NOW, 180);
  expect(findings.some((f) => f.kind === "drift" && f.severity === "error")).toBe(true);
  expect(findings.find((f) => f.kind === "drift")?.message).toContain("/v1/old");
});

test("a replaced page (new document_id) is an error even if fields match", () => {
  const { findings } = checkDrift([page()], baseline({ documentId: "old-id" }), [scenario()], NOW, 180);
  expect(findings.some((f) => f.kind === "page-replaced" && f.severity === "error")).toBe(true);
});

test("a moved page is an error, and locale-only redirects are not", () => {
  const moved = checkDrift([page({ finalUrl: "https://learn.microsoft.com/partner-center/developer/elsewhere" })], baseline(), [scenario()], NOW, 180);
  expect(moved.findings.some((f) => f.kind === "page-moved" && f.severity === "error")).toBe(true);

  const localeOnly = checkDrift([page({ finalUrl: "https://learn.microsoft.com/en-us/partner-center/developer/create-a-customer" })], baseline(), [scenario()], NOW, 180);
  expect(localeOnly.findings).toEqual([]);
});

test("a dead link is an error", () => {
  const { findings } = checkDrift([page({ status: 404, html: null })], baseline(), [scenario()], NOW, 180);
  expect(findings.some((f) => f.kind === "dead-link" && f.severity === "error")).toBe(true);
});

test("a page that stopped being readable is an error", () => {
  const { findings } = checkDrift([page({ html: "<p>nothing</p>" })], baseline(), [scenario()], NOW, 180);
  expect(findings.some((f) => f.kind === "extraction" && f.severity === "error")).toBe(true);
});

test("a stale scenario is a warning", () => {
  const { findings } = checkDrift([page()], baseline(), [scenario({ lastVerified: "2020-01-01" })], NOW, 180);
  expect(findings.some((f) => f.kind === "stale" && f.severity === "warning")).toBe(true);
});

test("fresh facts are returned so the caller can rewrite the snapshot", () => {
  const { fresh } = checkDrift([page()], baseline(), [scenario()], NOW, 180);
  expect(fresh[URL_A]?.requestSyntax).toEqual({ method: "POST", uri: "/v1/customers" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/docfacts-drift.test.ts`
Expected: FAIL — `Failed to resolve import "../src/docfacts/checks/drift.js"`

- [ ] **Step 3: Write the check**

Create `src/docfacts/checks/drift.ts`:

```ts
import type { Scenario } from "../../knowledge/schema.js";
import { extractDocFacts } from "../extract.js";
import type { PageFetch } from "../fetch.js";
import type { Finding } from "../findings.js";
import type { DocFacts, Snapshot } from "../types.js";

/** Fields the knowledge pack actually depends on. A source edit that leaves all
 *  of these identical cannot have invalidated anything we serve. */
function dependedOn(facts: DocFacts): string {
  return JSON.stringify({
    requestSyntax: facts.requestSyntax,
    headerNames: facts.headerNames,
    bodyFields: facts.bodyFields,
  });
}

/** Learn redirects bare paths to a locale, which is not a move. */
function canonicalPath(url: string): string {
  try {
    return new URL(url).pathname.replace(/^\/[a-z]{2}-[a-z]{2}\//i, "/").replace(/\/$/, "").toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

export function checkDrift(
  fetched: PageFetch[],
  snapshot: Snapshot,
  scenarios: Scenario[],
  now: Date,
  staleDays: number,
): { findings: Finding[]; fresh: Record<string, DocFacts> } {
  const findings: Finding[] = [];
  const fresh: Record<string, DocFacts> = {};

  for (const page of fetched) {
    if (page.html === null) {
      findings.push({
        kind: "dead-link", severity: "error", ref: page.url,
        message: `unreachable (${page.status || "ERR"})${page.error ? ": " + page.error : ""}.`,
      });
      continue;
    }

    const facts = extractDocFacts(page.url, page.finalUrl, page.html);
    fresh[page.url] = facts;
    const before = snapshot.pages[page.url];

    if (!before) {
      findings.push({
        kind: "unbaselined", severity: "warning", ref: page.url,
        message: "not in the snapshot, so it has never been compared.",
        detail: "Run `npm run check-docs:update` to record it.",
      });
      continue;
    }

    if (facts.extractionError !== null && before.extractionError === null) {
      findings.push({
        kind: "extraction", severity: "error", ref: page.url,
        message: `became unreadable (${facts.extractionError}). The Learn template may have changed.`,
      });
      continue;
    }

    if (canonicalPath(page.finalUrl) !== canonicalPath(before.finalUrl)) {
      findings.push({
        kind: "page-moved", severity: "error", ref: page.url,
        message: `now redirects to ${page.finalUrl}.`,
      });
    }

    if (facts.documentId !== before.documentId) {
      findings.push({
        kind: "page-replaced", severity: "error", ref: page.url,
        message: `document_id changed (${before.documentId} -> ${facts.documentId}); the page was replaced, not edited.`,
      });
    }

    if (facts.sourceSha !== before.sourceSha) {
      const changed = dependedOn(facts) !== dependedOn(before);
      findings.push(changed
        ? {
            kind: "drift", severity: "error", ref: page.url,
            message: "source changed AND a field the pack depends on changed.",
            detail: `was ${JSON.stringify(before.requestSyntax)} / headers ${JSON.stringify(before.headerNames)}; now ${JSON.stringify(facts.requestSyntax)} / headers ${JSON.stringify(facts.headerNames)}`,
          }
        : {
            kind: "drift-low", severity: "info", ref: page.url,
            message: "source changed, but no field the pack depends on changed.",
            detail: `${before.sourceSha} -> ${facts.sourceSha}`,
          });
    }
  }

  const cutoff = now.getTime() - staleDays * 86400000;
  for (const scenario of scenarios) {
    const verified = Date.parse(scenario.lastVerified);
    if (Number.isFinite(verified) && verified < cutoff) {
      const age = Math.floor((now.getTime() - verified) / 86400000);
      findings.push({
        kind: "stale", severity: "warning", ref: scenario.id,
        message: `last verified ${scenario.lastVerified} (${age} days ago).`,
      });
    }
  }

  return { findings, fresh };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/docfacts-drift.test.ts && npm run lint && npm run build`
Expected: 9 tests PASS.

- [ ] **Step 5: Rewrite the check-docs CLI**

Replace the whole contents of `scripts/check-docs.mjs`:

```js
// Weekly freshness check. Fetches every docUrl the pack references, compares
// against the committed snapshot, and writes doc-report.md.
//
// Exits non-zero only on HIGH severity: a dead or moved page, a replaced page,
// a page that stopped being readable, or a source edit that changed a field the
// pack depends on. A source edit that touched only prose is reported as
// informational — the previous whole-page text hash could not tell the two
// apart, and opening an issue for every upstream typo fix made the signal
// worthless.
//
// Pass --update (or UPDATE_SNAPSHOT=1) to write the refreshed snapshot.
import { writeFileSync } from "node:fs";
import { loadKnowledge } from "../dist/knowledge/load.js";
import { fetchAll } from "../dist/docfacts/fetch.js";
import { readSnapshot, writeSnapshot } from "../dist/docfacts/snapshot.js";
import { checkDrift } from "../dist/docfacts/checks/drift.js";
import { hasErrors } from "../dist/docfacts/findings.js";
import { renderReport } from "../dist/docfacts/report.js";

const STALE_DAYS = Number(process.env.STALE_DAYS ?? 180);
const update = process.env.UPDATE_SNAPSHOT === "1" || process.argv.includes("--update");

const knowledge = loadKnowledge("data");
const snapshot = readSnapshot();
const urls = [...new Set([
  ...knowledge.scenarios.map((s) => s.docUrl),
  ...knowledge.errors.map((e) => e.docUrl),
])].sort();

const fetched = await fetchAll(urls);
const { findings, fresh } = checkDrift(fetched, snapshot, knowledge.scenarios, new Date(), STALE_DAYS);

const count = (severity) => findings.filter((f) => f.severity === severity).length;
const report = renderReport("Documentation freshness report", findings, [
  `Checked **${urls.length}** doc URLs across ${knowledge.scenarios.length} scenarios and ${knowledge.errors.length} errors.`,
  `High severity: **${count("error")}**`,
  `Warnings: **${count("warning")}**`,
  `Informational (source changed, dependent fields unchanged): **${count("info")}**`,
]);

writeFileSync("doc-report.md", report);
if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, report, { flag: "a" });
console.log(report);

if (update) {
  writeSnapshot({ ...snapshot, pages: { ...snapshot.pages, ...fresh } });
  console.log("snapshot updated.");
}

process.exit(hasErrors(findings) ? 1 : 0);
```

Update `package.json` `scripts`:

```json
"check-docs": "node scripts/check-docs.mjs",
"check-docs:update": "node scripts/check-docs.mjs --update",
```

- [ ] **Step 6: Retire the hash baseline**

```bash
git rm data/doc-hashes.json
grep -rn "doc-hashes" --include=*.ts --include=*.mjs --include=*.yml --include=*.json --include=*.md . | grep -v node_modules
```

Expected: no matches.

- [ ] **Step 7: Gate the weekly workflow on high severity only**

In `.github/workflows/check-docs.yml`, confirm the issue-opening step is conditioned on the script's exit status (it already is — `check-docs` exits non-zero only on high severity now, so no change to the condition is needed). Update the step name and any comment that still describes hash-based drift:

```bash
grep -n "hash\|drift" .github/workflows/check-docs.yml
```

Reword any line that claims content hashing so the workflow describes what it now does.

- [ ] **Step 8: Verify end to end**

Run: `npm run build && npm run check-docs`
Expected: a report separating high severity from informational. With an unchanged pack this should exit 0.

- [ ] **Step 9: Commit**

```bash
git add src/docfacts/checks/drift.ts test/docfacts-drift.test.ts scripts/check-docs.mjs package.json .github/workflows/check-docs.yml
git add -u data/doc-hashes.json
git commit -m "feat(docfacts): replace text-hash drift with source-commit drift and severity"
```

---

### Task 9: Coverage measurement

**Files:**
- Create: `src/docfacts/checks/coverage.ts`, `src/docfacts/toc.ts`
- Modify: `scripts/docfacts-refresh.mjs`, `scripts/check-pack.mjs`
- Modify: `verification/doc-facts.json` (regenerated, now ~330 pages)
- Test: `test/docfacts-coverage.test.ts`

**Interfaces:**
- Consumes: `type Snapshot` (Task 2), `type Finding` (Task 6), `fetchPage` (Task 5).
- Produces: `TOC_URL: string`, `parseTocHrefs(json: unknown): string[]`, `fetchTocHrefs(): Promise<string[]>`, `tocHrefToUrl(href: string): string`, `checkCoverage(snapshot: Snapshot, scenarios: Scenario[]): Finding[]`.

- [ ] **Step 1: Write the failing test**

Create `test/docfacts-coverage.test.ts`:

```ts
import { test, expect } from "vitest";
import { parseTocHrefs, tocHrefToUrl } from "../src/docfacts/toc.js";
import { checkCoverage } from "../src/docfacts/checks/coverage.js";
import { emptySnapshot } from "../src/docfacts/snapshot.js";
import { EXTRACTOR_VERSION, type DocFacts, type Snapshot } from "../src/docfacts/types.js";
import type { Scenario } from "../src/knowledge/schema.js";

const covered = "https://learn.microsoft.com/partner-center/developer/create-a-customer";
const uncovered = "https://learn.microsoft.com/partner-center/developer/get-a-cart";
const conceptual = "https://learn.microsoft.com/partner-center/developer/get-started";

function facts(url: string, isEndpointPage: boolean): DocFacts {
  return {
    url, finalUrl: url, template: "partner-center", documentId: "d",
    sourceRepo: "MicrosoftDocs/partner-center-pr", sourceSha: "a".repeat(40), sourcePath: "p.md",
    msDate: null, updatedAt: null, title: url,
    requestSyntax: isEndpointPage ? { method: "GET", uri: "/v1/x" } : null,
    headerNames: [], bodyFields: [], isEndpointPage,
    extractionError: null, extractorVersion: EXTRACTOR_VERSION,
  };
}

const scenario = (docUrl: string): Scenario => ({
  id: "s1", area: "customers", title: "A", method: "GET", path: "/v1/x", authType: "app+user",
  headers: [], requestShape: null, responseShape: null,
  examples: { curl: "", csharp: "", typescript: "" }, gotchas: [],
  docUrl, lastVerified: "2026-07-01",
} as Scenario);

test("parseTocHrefs walks nested items and normalizes leading ./", () => {
  const toc = { items: [{ href: "./overview" }, { children: [{ href: "developer/create-a-customer" }, { items: [{ href: "developer/get-a-cart" }] }] }] };
  expect(parseTocHrefs(toc)).toEqual(["overview", "developer/create-a-customer", "developer/get-a-cart"]);
});

test("parseTocHrefs tolerates a shape it does not recognize", () => {
  expect(parseTocHrefs(null)).toEqual([]);
  expect(parseTocHrefs({})).toEqual([]);
});

test("tocHrefToUrl builds the canonical Learn URL", () => {
  expect(tocHrefToUrl("developer/create-a-customer")).toBe(covered);
});

function snapshot(): Snapshot {
  const snap = emptySnapshot("2026-07");
  snap.tocHrefs = ["developer/create-a-customer", "developer/get-a-cart", "developer/get-started"];
  snap.pages[covered] = facts(covered, true);
  snap.pages[uncovered] = facts(uncovered, true);
  snap.pages[conceptual] = facts(conceptual, false);
  return snap;
}

test("an endpoint page with no scenario is an informational gap", () => {
  const findings = checkCoverage(snapshot(), [scenario(covered)]);
  const gaps = findings.filter((f) => f.kind === "coverage-gap");
  expect(gaps).toHaveLength(1);
  expect(gaps[0]?.ref).toBe(uncovered);
  expect(gaps[0]?.severity).toBe("info");
});

test("conceptual pages are never reported as gaps", () => {
  expect(checkCoverage(snapshot(), [scenario(covered)]).some((f) => f.ref === conceptual)).toBe(false);
});

test("a scenario whose page left the TOC is a retirement candidate", () => {
  const snap = snapshot();
  snap.tocHrefs = ["developer/get-a-cart", "developer/get-started"];
  const findings = checkCoverage(snap, [scenario(covered)]);
  expect(findings.some((f) => f.kind === "retired-page" && f.severity === "warning" && f.ref === "s1")).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/docfacts-coverage.test.ts`
Expected: FAIL — `Failed to resolve import "../src/docfacts/toc.js"`

- [ ] **Step 3: Write the TOC reader**

Create `src/docfacts/toc.ts`:

```ts
import { fetchPage } from "./fetch.js";

// The whole-set TOC. `partner-center/developer/toc.json` does not exist — the
// developer section is a subtree of this one.
export const TOC_URL = "https://learn.microsoft.com/en-us/partner-center/toc.json";

const LEARN_BASE = "https://learn.microsoft.com/partner-center/";

interface TocNode {
  href?: unknown;
  items?: unknown;
  children?: unknown;
}

/** Depth-first list of every href in the TOC, in document order. */
export function parseTocHrefs(json: unknown): string[] {
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== "object") return;
    const { href, items, children } = node as TocNode;
    if (typeof href === "string") out.push(href.replace(/^\.\//, ""));
    for (const branch of [items, children]) {
      if (Array.isArray(branch)) for (const child of branch) walk(child);
    }
  };
  walk(json);
  return out;
}

export function tocHrefToUrl(href: string): string {
  return LEARN_BASE + href.replace(/^\.\//, "").replace(/\/$/, "");
}

export async function fetchTocHrefs(): Promise<string[]> {
  const page = await fetchPage(TOC_URL);
  if (page.html === null) throw new Error(`${TOC_URL}: unreachable (${page.status || "ERR"})`);
  return parseTocHrefs(JSON.parse(page.html));
}
```

- [ ] **Step 4: Write the coverage check**

Create `src/docfacts/checks/coverage.ts`:

```ts
import type { Scenario } from "../../knowledge/schema.js";
import type { Finding } from "../findings.js";
import { tocHrefToUrl } from "../toc.js";
import type { Snapshot } from "../types.js";

function canonical(url: string): string {
  try {
    return new URL(url).pathname.replace(/^\/[a-z]{2}-[a-z]{2}\//i, "/").replace(/\/$/, "").toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

/**
 * Gaps are informational by design. 247 documented developer pages had no
 * scenario when this was written; making them errors would leave CI red
 * forever. They are a work list for sub-project B, not a build failure.
 */
export function checkCoverage(snapshot: Snapshot, scenarios: Scenario[]): Finding[] {
  const findings: Finding[] = [];
  const covered = new Set(scenarios.map((s) => canonical(s.docUrl)));

  for (const href of snapshot.tocHrefs) {
    if (!href.startsWith("developer/")) continue;
    const url = tocHrefToUrl(href);
    const facts = snapshot.pages[url];
    if (!facts || !facts.isEndpointPage) continue;
    if (covered.has(canonical(url))) continue;
    findings.push({
      kind: "coverage-gap", severity: "info", ref: url,
      message: `documented endpoint with no scenario: ${facts.requestSyntax?.method ?? "?"} ${facts.requestSyntax?.uri ?? "?"}`,
      detail: facts.title ?? undefined,
    });
  }

  const inToc = new Set(snapshot.tocHrefs.map((href) => canonical(tocHrefToUrl(href))));
  for (const scenario of scenarios) {
    const path = canonical(scenario.docUrl);
    if (!path.startsWith("/partner-center/")) continue;
    if (inToc.has(path)) continue;
    findings.push({
      kind: "retired-page", severity: "warning", ref: scenario.id,
      message: `${scenario.docUrl} is no longer listed in the Learn TOC; the page may have been retired.`,
    });
  }

  return findings;
}
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run test/docfacts-coverage.test.ts && npm run lint && npm run build`
Expected: 6 tests PASS.

- [ ] **Step 6: Extend the refresh to the whole developer section**

In `scripts/docfacts-refresh.mjs`, add the TOC import:

```js
import { fetchTocHrefs, tocHrefToUrl } from "../dist/docfacts/toc.js";
```

Replace the `urls` constant and the snapshot construction:

```js
console.log("fetching the Learn TOC...");
const tocHrefs = await fetchTocHrefs();
const developerUrls = tocHrefs.filter((h) => h.startsWith("developer/")).map(tocHrefToUrl);

const urls = [...new Set([
  ...knowledge.scenarios.map((s) => s.docUrl),
  ...knowledge.errors.map((e) => e.docUrl),
  ...developerUrls,
])].sort();

console.log(`fetching ${urls.length} pages...`);
const fetched = await fetchAll(urls);

const snapshot = emptySnapshot(new Date().toISOString().slice(0, 7));
snapshot.tocHrefs = tocHrefs;
```

- [ ] **Step 7: Add coverage to the offline gate**

In `scripts/check-pack.mjs`, add the import and fold the findings in:

```js
import { checkCoverage } from "../dist/docfacts/checks/coverage.js";
```

```js
const findings = [...checkFields(snapshot, knowledge.scenarios), ...checkCoverage(snapshot, knowledge.scenarios)];
```

And add a summary line:

```js
  `Documented endpoints with no scenario: **${findings.filter((f) => f.kind === "coverage-gap").length}**`,
```

- [ ] **Step 8: Regenerate and inspect**

Run: `npm run build && npm run docfacts:refresh && npm run check-pack`

Expected: the snapshot grows to roughly 330 pages; `check-pack` still exits 0 (gaps are informational) and its report lists the documented endpoints with no scenario. That list is sub-project B's input — read it, do not act on it here.

- [ ] **Step 9: Commit**

```bash
git add src/docfacts/toc.ts src/docfacts/checks/coverage.ts test/docfacts-coverage.test.ts scripts/docfacts-refresh.mjs scripts/check-pack.mjs
git commit -m "feat(docfacts): measure scenario coverage against the Learn TOC"
git add verification/doc-facts.json
git commit -m "chore(docfacts): extend the snapshot to the whole developer section"
```

---

### Task 10: Eval coverage gate and precise assertions

**Files:**
- Modify: `scripts/eval.mjs`, `data/evals.json`

**Interfaces:**
- Consumes: `allTools` from `dist/tools/index.js`.
- Produces: eval cases may now carry `assert: [{ path: string, equals: unknown }]` alongside `contains`/`notContains`.

- [ ] **Step 1: Give the docFetch stub something to return**

`pc_search_docs` delegates entirely to `ctx.docFetch`, so against today's empty stub it can only ever
return `{"excerpts":[]}` — nothing worth asserting. Replace the `ctx` line in `scripts/eval.mjs` with
a stub that returns one deterministic excerpt, which makes `topK` slicing observable:

```js
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
```

No existing case asserts on an empty excerpt list, so this cannot break one.

- [ ] **Step 2: Add the gate and the assertion form**

Replace the body of `scripts/eval.mjs` below the `cases`/`ctx`/`byName` declarations:

```js
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
  const wrong = (c.assert ?? [])
    .map((a) => ({ a, actual: valueAt(data, a.path) }))
    .filter(({ a, actual }) => JSON.stringify(actual) !== JSON.stringify(a.equals))
    .map(({ a, actual }) => `${a.path}=${JSON.stringify(actual)} expected ${JSON.stringify(a.equals)}`);

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
```

- [ ] **Step 3: Run it to see the gate fail**

Run: `npm run build && npm run eval`
Expected: FAIL — `no eval case for: pc_search_docs, pc_diagnose, pc_plan_csp_onboarding, pc_plan_user_onboarding, pc_plan_user_offboarding`

- [ ] **Step 4: Add the missing cases and tighten two existing ones**

Every `path` and `contains` value below was read off the tools' real output, not guessed. The plan
tools return `{ goal, steps, notes }`; `pc_get_scenario` returns the scenario's fields at the top
level (not nested under `scenario`); `pc_get_enums` returns `{ name, description, values, docUrl }`;
`pc_diagnose` returns `{ likely, nextSteps }`.

In `data/evals.json`, add to `cases`:

```jsonc
{ "name": "diagnose maps a 401 to the retired-audience error", "tool": "pc_diagnose", "input": { "symptom": "401 unauthorized when calling the API" }, "contains": ["900420", "api.partnercenter.microsoft.com"] },
{ "name": "search passes live excerpts through", "tool": "pc_search_docs", "input": { "query": "create a customer" }, "contains": ["create-a-customer"] },
{ "name": "search honours topK", "tool": "pc_search_docs", "input": { "query": "customers", "topK": 1 }, "assert": [{ "path": "excerpts.length", "equals": 1 }] },
{ "name": "csp onboarding starts at the relationship request", "tool": "pc_plan_csp_onboarding", "input": {}, "contains": ["get-reseller-relationship-url", "create-agreement"], "assert": [{ "path": "steps.0.order", "equals": 1 }] },
{ "name": "user onboarding creates before it licenses", "tool": "pc_plan_user_onboarding", "input": {}, "contains": ["create-user", "assign-licenses"], "assert": [{ "path": "steps.0.scenarioId", "equals": "get-subscribed-skus" }] },
{ "name": "user offboarding reads licenses before deleting", "tool": "pc_plan_user_offboarding", "input": {}, "contains": ["get-user-licenses", "delete-user"], "assert": [{ "path": "steps.0.scenarioId", "equals": "get-user-licenses" }] }
```

Then replace two existing cases so they assert exact values instead of substrings:

```jsonc
// replaces: { "name": "scenario detail has the REST path", ... "contains": ["/v1/customers"] }
{ "name": "scenario detail has the REST path", "tool": "pc_get_scenario", "input": { "id": "create-customer" },
  "assert": [{ "path": "path", "equals": "/v1/customers" }, { "path": "method", "equals": "POST" }] },
// replaces: { "name": "enum lookup returns values", ... "contains": ["monthly", "one_time"] }
{ "name": "enum lookup returns values", "tool": "pc_get_enums", "input": { "name": "billingCycle" },
  "contains": ["monthly", "one_time"], "assert": [{ "path": "name", "equals": "billingCycle" }] }
```

`excerpts.length` and `steps.0.scenarioId` both work with the dotted-path reducer from Step 2:
`length` is a real property of an array, and a numeric key indexes one.

- [ ] **Step 5: Run the eval**

Run: `npm run eval`
Expected: `eval: 24/24 passed, 23/23 tools covered` — 18 existing cases (two of them rewritten in place) plus the 6 added above.

- [ ] **Step 6: Verify the gate actually bites**

Temporarily delete the `pc_diagnose` case from `data/evals.json`, run `npm run eval`, and confirm it exits 1 with `no eval case for: pc_diagnose`. Restore the case.

- [ ] **Step 7: Commit**

```bash
git add scripts/eval.mjs data/evals.json
git commit -m "test(eval): require a case per tool and add exact-value assertions"
```

---

### Task 11: Documentation and release

**Files:**
- Modify: `README.md`, `CONTRIBUTING.md`, `package.json`

- [ ] **Step 1: Document the commands in README**

In the `## Develop` section, replace the sentence describing `npm run check-docs` with:

```markdown
Verification runs in two halves. `npm run check-pack` is offline and runs on every PR: it verifies
each scenario's `method`, `path`, and headers against `verification/doc-facts.json` — a committed
snapshot of what the Microsoft Learn pages actually say — and reports documented endpoints that have
no scenario yet. `npm run check-docs` is the weekly networked half: it re-fetches every referenced
page and compares it to the snapshot, keying drift off the source commit each Learn page embeds. It
fails only when a field the pack depends on changed; an upstream edit that touched only prose is
reported without opening an issue. `npm run docfacts:refresh` rebuilds the snapshot from scratch.
```

- [ ] **Step 2: Document the contributor workflow**

In `CONTRIBUTING.md`, add under the section covering knowledge-pack changes:

```markdown
### Verifying a scenario against the docs

`npm run check-pack` compares every scenario's `method` and `path` against the snapshot in
`verification/doc-facts.json` and fails the build on a mismatch. If you add or change a scenario
whose `docUrl` is not yet snapshotted, run `npm run check-docs:update` to record it, and commit the
snapshot change alongside your scenario change. Never edit `verification/doc-facts.json` by hand —
it is generated, and a hand-edit would assert something the docs do not say.
```

- [ ] **Step 3: Confirm the snapshot stays unpublished**

Run: `npm pack --dry-run 2>&1 | grep -E "verification|doc-hashes"; echo "matches=$?"`
Expected: `matches=1` (no output, grep found nothing).

- [ ] **Step 4: Full verification**

Run: `npm ci && npm run lint && npm run build && npm run test:coverage && npm run check-pack && npm run eval && npm run export && git diff --exit-code -- generated/`
Expected: all green.

- [ ] **Step 5: Release**

```bash
npm version minor -m "chore(release): %s"
```

- [ ] **Step 6: Commit any remaining documentation**

```bash
git add README.md CONTRIBUTING.md
git commit -m "docs: describe the two-half verification workflow"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
| --- | --- |
| 1. One extractor, one snapshot, pure checks | 1, 2, 3, 4 |
| 2. Two commands split by network dependence | 5 (`docfacts:refresh`), 7 (`check-pack`), 8 (`check-docs`) |
| 3. `DocFacts` shape, `extractionError`, `extractorVersion`, snapshot file shape | 2, 4 |
| 4. Drift with severity | 8 |
| 5. Field verification | 6 |
| 6. Coverage gap | 9 |
| 7. Eval gate | 10 |
| 8. CI wiring | 7 (`ci.yml`), 8 (`check-docs.yml`) |
| 9. Testing (4 fixtures, offline check tests, `extractionError` tripwire) | 2, 3 (fixtures), 6, 8, 9 (offline), 8 (tripwire) |
| Retire `data/doc-hashes.json` | 8 |
| `verification/` unpublished | 5 (verified), 11 (re-verified) |

**Deviations from the spec, and why:**

- The spec's section 2 table lists eval inside `check-pack`. Here `npm run eval` stays its own script and its own CI step, as it already is; both are offline and both block. Same gate, one less indirection.
- The spec described the snapshot as holding `tocHrefs`; Task 9 adds those only when TOC ingestion lands, so the snapshot written in Task 5 has an empty `tocHrefs` array. The schema carries the field from the start, so no migration is needed.

---

## Amendment (2026-07-29): Task 7 splits into 7A / 7B / 7C

Running `checkFields` against the real pack for the first time produced **19 errors**. Triage showed
they were not 19 instances of one problem, and that Task 7 as written would have corrupted the
knowledge pack. Two rulings were taken by the human partner; this amendment records them and the
resulting split.

### What the 19 errors actually were

| Class | Count | Cause |
| --- | --- | --- |
| A | 17 | The pack stores an absolute URL in `path` for scenarios on a non-Partner-Center host; the docs state the route relative (and Graph docs omit the `/v1.0` prefix). Segment counts differ, so every one reports as a path mismatch. |
| B | 1 | `create-subscription-transition`: its doc page documents **two** endpoints (`<h4 id="request-syntax">` GET transitionEligibilities and `<h4 id="request-syntax-1">` POST transitions). The extractor reads only the first, so the scenario compares against the wrong endpoint. |
| C | 1 | `get-fraud-events`: the extracted URI is `/v1/fraudEvents>` — a stray `>` leaking from the page markup. |

### Ruling 1 (Class A): apply the plan — make the pack relative

Task 7 as written says the docs are authoritative for `method` and `path`. Applying that literally
rewrites 18 absolute paths into relative ones, which silently breaks request building:
`src/tools/buildRequest.ts:67` and `src/tools/generateCall.ts:119` both branch on
`path.startsWith("http")` to decide whether to prepend the Partner Center base URL. This concern was
raised and the human partner confirmed the plan governs, **with** the host moved onto the scenario so
the tools keep working. That expansion is Task 7B.

### Ruling 2 (Class B): extract every request-syntax table, match any

`DocFacts` gains all of a page's request syntaxes rather than only the first, and field verification
passes when the scenario matches **any** of them. Learn suffixes duplicate heading ids (`request-syntax`,
`request-syntax-1`, …; `http-request`, `http-request-1`, …), so enumeration is deterministic. That is
Task 7A.

### The split

- **Task 7A — extractor: all request syntaxes, and the stray-`>` artifact.** Changes `DocFacts`,
  `extract.ts`, and `checks/fields.ts`; regenerates the snapshot.
- **Task 7B — pack: relative paths and a per-scenario API base.** Adds an `api` field to the scenario
  schema, rewrites the 18 absolute paths, and updates `buildRequest.ts` / `generateCall.ts` to resolve
  the base from that field instead of sniffing `startsWith("http")`.
- **Task 7C — the offline gate.** The original Task 7: `report.ts`, `scripts/check-pack.mjs`, and the
  `ci.yml` wiring, run to green.

Tasks 8-11 are unchanged and still follow.
