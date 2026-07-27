# CI & Supply-Chain Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make dependency regressions visible automatically, cover the untested HTTP entry point, and add a quality floor (lint, coverage, honest Node matrix) without growing the dependency surface.

**Architecture:** Seven independently committable tasks. Task 1 lands the already-verified security fix. Task 2 splits `src/http.ts` into a testable factory plus a thin bin entry and adds the integration test that guards the `@hono/node-server` override. Tasks 3–5 add tooling. Task 6 adds automation. Task 7 raises the Node floor and releases 0.9.0.

**Tech Stack:** TypeScript 5.9 (NodeNext, strict), Vitest 4, `@modelcontextprotocol/sdk` 1.29, Biome 2.5, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-07-27-ci-supply-chain-hardening-design.md`

## Global Constraints

- Node floor moves to `>=20`; CI matrix is exactly `[20, 22, 24]`. Node 18 is EOL and is dropped.
- `publish.yml` and `check-docs.yml` pin `node-version: "24"` — no `lts/*` anywhere.
- The audit step **never** fails CI. Lint **does** fail CI.
- Biome runs **linter only**. The formatter stays disabled — the codebase uses a deliberate compact style (single-line guard clauses) that the formatter would rewrite wholesale.
- No new runtime dependencies. New dev dependencies are limited to `@biomejs/biome` and `@vitest/coverage-v8`.
- No coverage threshold is set in this plan. Measure only.
- Every task ends green: `npm run build && npm test` both pass before committing.
- Commit messages follow the repo's Conventional Commits style (`feat:`, `chore:`, `test:`, `ci:`, `refactor:`).
- Do **not** add a Claude co-author trailer to commits.

---

### Task 1: Land the pending security fix

The working tree already contains `vitest ^2.0.0 -> ^4.1.10` and `overrides: { "@hono/node-server": "^2.0.5" }`, plus the regenerated lockfile. This was verified by hand: build passes, 57 tests pass, and the HTTP transport was smoke-tested against the v2 override (`/healthz`, `initialize`, `tools/list` all correct). This task commits it.

`generated/openapi.json` and `generated/partner-center.postman_collection.json` are also modified in the working tree. They are `npm run export` output, unrelated to the security fix. Commit them **separately** so the security commit stays reviewable.

**Files:**
- Modify: `package.json` (already changed — `devDependencies.vitest`, `overrides`, `bin`)
- Modify: `package-lock.json` (already changed)

**Interfaces:**
- Consumes: nothing.
- Produces: a clean `npm audit` for every later task.

- [ ] **Step 1: Confirm the tree is clean and the fix is real**

```bash
npm ci
npm audit
```

Expected: `found 0 vulnerabilities`.

- [ ] **Step 2: Confirm build and tests pass**

```bash
npm run build && npm test
```

Expected: build silent, `Test Files 12 passed (12)`, `Tests 57 passed (57)`.

- [ ] **Step 3: Commit the security fix on its own**

```bash
git add package.json package-lock.json
git commit -m "fix(deps): bump vitest to 4 and override @hono/node-server to ^2.0.5

Clears two moderate advisories:
- GHSA-frvp-7c67-39w9: @hono/node-server <2.0.5 path traversal in serve-static
  on Windows via encoded backslash. Transitive via @modelcontextprotocol/sdk,
  which declares ^1.19.9; all of 1.x is affected and no 1.x patch exists.
- GHSA-67mh-4wv8-2f99: esbuild <=0.24.2 dev server, transitive via vitest@2.

Not exploitable here (src/http.ts uses raw node:http, never serve-static), but
the override clears the audit and protects consumers."
```

- [ ] **Step 4: Commit the regenerated export artifacts separately**

```bash
git add generated/openapi.json generated/partner-center.postman_collection.json
git commit -m "chore: regenerate OpenAPI and Postman export artifacts"
```

---

### Task 2: Extract the HTTP app factory and test it

`src/http.ts` calls `listen()` at module scope, so importing it opens a port. It cannot be tested as written, which is why it has zero coverage today — and it is the one file the `@hono/node-server` override affects, because the SDK's `server/streamableHttp.js` imports `getRequestListener` from it.

Split along that seam, matching how `src/server.ts` already exports `createServer` rather than self-starting.

**Files:**
- Create: `src/http/app.ts`
- Modify: `src/http.ts` (full rewrite, 55 lines -> ~20)
- Test: `test/http.test.ts`

**Interfaces:**
- Consumes: `createServer(tools: Tool[], ctx: ToolContext, version?: string): McpServer` from `src/server.js`; `allTools: Tool[]` from `src/tools/index.js`; `ToolContext = { knowledge: Knowledge; docFetch: DocFetch }` from `src/types.js`.
- Produces: `createHttpApp(opts: { ctx: ToolContext; version: string }): import("node:http").Server` from `src/http/app.js`. The returned server is **not** listening; the caller calls `.listen()`.

- [ ] **Step 1: Write the failing test**

Create `test/http.test.ts`:

```ts
import { test, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createHttpApp } from "../src/http/app.js";
import type { Knowledge, ToolContext } from "../src/types.js";

const ctx: ToolContext = {
  knowledge: {} as Knowledge,
  docFetch: async () => ({ ok: true, excerpts: [] }),
};

let server: Server;
let base: string;

beforeAll(async () => {
  server = createHttpApp({ ctx, version: "9.9.9" });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function rpc(body: unknown): Promise<Response> {
  return fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(body),
  });
}

test("GET /healthz reports ok and the version", async () => {
  const res = await fetch(`${base}/healthz`);
  expect(res.status).toBe(200);
  await expect(res.json()).resolves.toEqual({ ok: true, version: "9.9.9" });
});

test("POST /mcp initialize returns the server identity", async () => {
  const res = await rpc({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "vitest", version: "1" },
    },
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { result?: { serverInfo?: { name?: string; version?: string } } };
  expect(body.result?.serverInfo?.name).toBe("partner-center-mcp");
  expect(body.result?.serverInfo?.version).toBe("9.9.9");
});

test("POST /mcp tools/list returns the tool registry", async () => {
  const res = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { result?: { tools?: { name: string }[] } };
  expect(body.result?.tools?.length).toBeGreaterThan(0);
  expect(body.result?.tools?.map((t) => t.name)).toContain("pc_list_scenarios");
});

test("an unknown path is 404", async () => {
  const res = await fetch(`${base}/nope`);
  expect(res.status).toBe(404);
});

test("GET /mcp is 405 and advertises POST", async () => {
  const res = await fetch(`${base}/mcp`);
  expect(res.status).toBe(405);
  expect(res.headers.get("allow")).toBe("POST");
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run test/http.test.ts
```

Expected: FAIL — cannot resolve `../src/http/app.js`.

- [ ] **Step 3: Create the factory**

Create `src/http/app.ts`:

```ts
import { createServer as createHttpServer } from "node:http";
import type { IncomingMessage, Server } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "../server.js";
import { allTools } from "../tools/index.js";
import type { ToolContext } from "../types.js";

export interface HttpAppOptions {
  ctx: ToolContext;
  version: string;
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      try { resolve(raw ? JSON.parse(raw) : undefined); } catch { resolve(undefined); }
    });
    req.on("error", () => resolve(undefined));
  });
}

// Builds the HTTP server without starting it, so tests can bind an ephemeral port.
// Same tools, resources, and prompts as the stdio entry point, served statelessly
// over Streamable HTTP at POST /mcp.
export function createHttpApp({ ctx, version }: HttpAppOptions): Server {
  return createHttpServer(async (req, res) => {
    const path = (req.url ?? "").split("?")[0];
    if (path === "/healthz") { res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, version })); return; }
    if (path !== "/mcp") { res.writeHead(404, { "content-type": "text/plain" }).end("Not found"); return; }
    if (req.method !== "POST") { res.writeHead(405, { Allow: "POST" }).end("Method Not Allowed"); return; }

    try {
      const body = await readBody(req);
      // Stateless: a fresh server + transport per request.
      const server = createServer(allTools, ctx, version);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on("close", () => { void transport.close(); void server.close(); });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (err) {
      if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: String((err as Error)?.message ?? err) }));
    }
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run test/http.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Rewrite the bin entry to use the factory**

Replace the whole of `src/http.ts` with:

```ts
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { createHttpApp } from "./http/app.js";
import { loadKnowledge } from "./knowledge/load.js";
import { makeDocFetch } from "./docs/fetch.js";

// Remote/HTTP variant of the server. All request handling lives in ./http/app.ts;
// this file only wires up real dependencies and binds the port.
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

let version = "0.0.0";
try { version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version ?? version; } catch { /* ignore */ }

const ctx = { knowledge: loadKnowledge(join(root, "data")), docFetch: makeDocFetch() };
const port = Number(process.env.PORT ?? process.argv[2] ?? 3000);

createHttpApp({ ctx, version })
  .listen(port, () => console.error(`partner-center-mcp HTTP server listening on http://localhost:${port}/mcp`));
```

- [ ] **Step 6: Verify the build and the full suite**

```bash
npm run build && npm test
```

Expected: build silent; `Test Files 13 passed (13)`, `Tests 62 passed (62)`.

- [ ] **Step 7: Verify the real binary still starts**

```bash
PORT=39118 node dist/http.js &
sleep 2
curl -s http://localhost:39118/healthz
```

Expected: `{"ok":true,"version":"0.8.0"}`. Stop the process afterwards.

- [ ] **Step 8: Commit**

```bash
git add src/http.ts src/http/app.ts test/http.test.ts
git commit -m "refactor(http): extract createHttpApp so the HTTP entry point is testable

src/http.ts called listen() at module scope, so it could not be imported by a
test and had zero coverage. Split request handling into src/http/app.ts, mirroring
how src/server.ts exports createServer rather than self-starting.

Adds test/http.test.ts covering healthz, initialize, tools/list, 404 and 405.
initialize and tools/list run through StreamableHTTPServerTransport, which calls
getRequestListener from @hono/node-server, so these fail if the ^2.0.5 override
ever breaks that call. They do not detect the override going missing — deleting
it resolves back to a working v1.x, and only npm audit notices that."
```

---

### Task 3: Add Biome (linter only)

Biome over ESLint: `eslint` + `typescript-eslint` would add roughly a hundred transitive dev packages to the tree this work exists to shrink and watch. Biome is one dependency.

The formatter stays **off**. The codebase uses deliberate single-line guard clauses (`if (path === "/healthz") { ...; return; }`); Biome's formatter rewrites those unconditionally, producing a large diff that is pure style churn and discards the author's chosen layout.

**Files:**
- Create: `biome.json`
- Modify: `package.json` (add `devDependencies.@biomejs/biome`, `scripts.lint`, `scripts.lint:fix`)

**Interfaces:**
- Consumes: nothing.
- Produces: `npm run lint`, consumed by Task 6's CI wiring.

- [ ] **Step 1: Install Biome**

```bash
npm install -D @biomejs/biome@^2.5.5
```

- [ ] **Step 2: Create `biome.json`**

```json
{
  "$schema": "https://biomejs.dev/schemas/2.5.5/schema.json",
  "files": {
    "includes": [
      "src/**/*.ts",
      "test/**/*.ts",
      "scripts/**/*.mjs"
    ]
  },
  "formatter": { "enabled": false },
  "linter": {
    "enabled": true,
    "rules": { "recommended": true }
  },
  "assist": { "enabled": false }
}
```

- [ ] **Step 3: Add the scripts**

In `package.json`, alongside the existing `scripts`:

```json
"lint": "biome check .",
"lint:fix": "biome check --write .",
```

- [ ] **Step 4: Run the linter and read every finding**

```bash
npm run lint
```

This will report findings. Triage each one against these rules:

- **Genuine defect** (unused variable, unreachable branch, shadowed name, `==` where `===` belongs) — fix it.
- **Deliberate and correct** — the clearest example is `run(args: any, ctx: ToolContext)` in `src/types.ts:26`, where `any` is intentional because each tool narrows its own args via its Zod shape. Do not contort the type to satisfy the rule.
- **Style-only noise** that would force a rewrite of working code — disable the rule in `biome.json` rather than churning the source.

For a rule disabled repo-wide, add it under `linter.rules` with a comment in the commit message explaining why. For a single justified site, use `// biome-ignore lint/suspicious/noExplicitAny: <reason>`.

Behavioural changes are out of scope for this task. If a finding cannot be resolved without changing behaviour, leave the code alone, disable the rule, and note it in the commit message.

- [ ] **Step 5: Verify lint is clean and nothing else broke**

```bash
npm run lint && npm run build && npm test
```

Expected: lint reports no diagnostics; build silent; 62 tests pass.

- [ ] **Step 6: Commit**

```bash
git add biome.json package.json package-lock.json src test
git commit -m "chore: add Biome linter

Linter only; the formatter is disabled on purpose. The codebase uses compact
single-line guard clauses that Biome's formatter would rewrite wholesale, which
is style churn rather than improvement.

Chosen over ESLint because eslint + typescript-eslint would add ~100 transitive
dev packages to the dependency tree this work exists to shrink."
```

---

### Task 4: Tighten the compiler

`tsconfig.json` is already `strict: true`. These three flags recover part of what type-aware linting would have given, now that Biome (which has no type-aware rules) is the linter.

**Files:**
- Modify: `tsconfig.json`
- Modify: whichever files under `src/` the new flags flag

**Interfaces:**
- Consumes: nothing.
- Produces: nothing new; tightens existing types.

- [ ] **Step 1: Add the flags**

In `tsconfig.json`, inside `compilerOptions`, after `"strict": true`:

```json
"noUncheckedIndexedAccess": true,
"noImplicitOverride": true,
"verbatimModuleSyntax": true,
```

- [ ] **Step 2: Run the build to see the failures**

```bash
npm run build
```

Expected: FAIL. Two distinct classes:

- `verbatimModuleSyntax` — every import used only as a type must say `import type`. Mechanical.
- `noUncheckedIndexedAccess` — indexing an array or record now yields `T | undefined`. Expect hits in `src/knowledge/load.ts` and the tools that index parsed JSON, plus `src/http/app.ts:` `(req.url ?? "").split("?")[0]` is now `string | undefined`.

- [ ] **Step 3: Fix the `verbatimModuleSyntax` errors**

Add the `type` keyword to type-only imports. Example — in `src/http/app.ts` the import is already correct:

```ts
import type { IncomingMessage, Server } from "node:http";
```

Apply the same to any file the compiler names.

- [ ] **Step 4: Fix the `noUncheckedIndexedAccess` errors**

Handle the `undefined` case honestly — do not silence it with `!`. For the known `src/http/app.ts` case:

```ts
const path = (req.url ?? "").split("?")[0] ?? "";
```

For array lookups in the knowledge layer, prefer an explicit guard or a default that matches existing behaviour. If a site is genuinely unreachable, add a narrow comment saying why rather than a bare `!`.

- [ ] **Step 5: Verify**

```bash
npm run lint && npm run build && npm test
```

Expected: all three clean; 62 tests pass.

- [ ] **Step 6: Commit**

```bash
git add tsconfig.json src
git commit -m "chore: enable noUncheckedIndexedAccess, noImplicitOverride, verbatimModuleSyntax

Biome has no type-aware rules, so the compiler covers that ground instead.
Mechanical only: no behavioural change."
```

---

### Task 5: Measure coverage

Measurement only. No threshold — setting a number before knowing the baseline produces either a meaningless floor or an instant failure. The floor gets set in a follow-up, once this reports a real number.

**Files:**
- Modify: `vitest.config.ts`
- Modify: `package.json` (add `devDependencies.@vitest/coverage-v8`, `scripts.test:coverage`)
- Modify: `.gitignore` (ignore `coverage/`)

**Interfaces:**
- Consumes: nothing.
- Produces: `npm run test:coverage`.

- [ ] **Step 1: Install the coverage provider**

The version must track `vitest` exactly.

```bash
npm install -D @vitest/coverage-v8@^4.1.10
```

- [ ] **Step 2: Configure it**

Replace `vitest.config.ts` with:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
      // No thresholds yet: measure first, then set the floor at the observed
      // number so it can only ratchet upward.
    },
  },
});
```

- [ ] **Step 3: Add the script**

In `package.json`:

```json
"test:coverage": "vitest run --coverage",
```

- [ ] **Step 4: Ignore the output directory**

Add to `.gitignore`, under the existing `dist/` line:

```
coverage/
```

- [ ] **Step 5: Run it and record the baseline**

```bash
npm run test:coverage
```

Expected: 62 tests pass and a coverage table prints. Confirm `src/http/app.ts` shows non-zero coverage — that is the gap Task 2 closed, and seeing it here proves the new test actually exercises the file.

Write the overall line-coverage percentage into the commit message.

- [ ] **Step 6: Commit**

```bash
git add vitest.config.ts package.json package-lock.json .gitignore
git commit -m "test: measure coverage with @vitest/coverage-v8

Reporting only, no threshold. Baseline recorded so a floor can be set in a
follow-up and only ratchet upward."
```

---

### Task 6: Dependabot, audit workflow, and CI wiring

**Files:**
- Create: `.github/dependabot.yml`
- Create: `.github/workflows/audit.yml`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `npm run lint` from Task 3.
- Produces: nothing consumed by later tasks. Task 7 edits `ci.yml` again, for the matrix.

- [ ] **Step 1: Create `.github/dependabot.yml`**

```yaml
version: 2

# Minor and patch updates arrive grouped to keep PR volume low. Majors stay
# separate and ungrouped: they are deliberate decisions, not routine bumps.
updates:
  - package-ecosystem: npm
    directory: "/"
    schedule:
      interval: weekly
    groups:
      npm-minor-patch:
        update-types: ["minor", "patch"]

  - package-ecosystem: github-actions
    directory: "/"
    schedule:
      interval: weekly
    groups:
      actions:
        update-types: ["minor", "patch"]

  - package-ecosystem: nuget
    directory: "/dotnet"
    schedule:
      interval: weekly
    groups:
      nuget-minor-patch:
        update-types: ["minor", "patch"]
```

- [ ] **Step 2: Create `.github/workflows/audit.yml`**

This mirrors the issue-raising pattern already proven in `check-docs.yml`. A report-only step buried in CI logs is invisible; an issue is not.

```yaml
name: Dependency audit

# Weekly npm audit. Never blocks CI: on findings it opens (or updates) an issue,
# because an advisory with no upstream fix must not lock unrelated PRs. That is
# exactly what happened with GHSA-frvp-7c67-39w9 (@hono/node-server), where the
# only remedy was a hand-written override.
on:
  schedule:
    - cron: "0 6 * * 2" # Tuesdays 06:00 UTC, a day after the doc-freshness check
  workflow_dispatch:

permissions:
  contents: read
  issues: write

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: "24"
      - run: npm ci

      # The step's exit code must come from `npm audit`, not from the trailing
      # echo, or `outcome` is always 'success' and the issue never opens.
      - id: audit
        run: |
          {
            echo '## `npm audit` findings'
            echo ''
            echo '```'
          } > audit-report.md
          set +e
          npm audit --audit-level=moderate >> audit-report.md 2>&1
          code=$?
          set -e
          echo '```' >> audit-report.md
          exit $code
        continue-on-error: true

      - name: Open or update audit issue
        if: steps.audit.outcome == 'failure'
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          gh label create dependency-audit --color D93F0B --description "npm audit findings" 2>/dev/null || true
          existing=$(gh issue list --state open --label dependency-audit --json number -q '.[0].number')
          if [ -n "$existing" ]; then
            gh issue comment "$existing" --body-file audit-report.md
          else
            gh issue create --title "🔒 Dependency vulnerabilities detected" --label dependency-audit --body-file audit-report.md
          fi
```

- [ ] **Step 3: Wire lint and a non-blocking audit into `ci.yml`**

In `.github/workflows/ci.yml`, insert after the `npm ci` step and before `npm test`:

```yaml
      - run: npm run lint
      - name: Audit (report only, never blocks)
        run: npm audit --audit-level=moderate
        continue-on-error: true
```

Order matters: lint is fast and deterministic, so it should fail before the slower steps run.

- [ ] **Step 4: Validate the YAML parses**

```bash
node -e "const{readFileSync}=require('fs');for(const f of ['.github/dependabot.yml','.github/workflows/audit.yml','.github/workflows/ci.yml'])readFileSync(f,'utf8')&&console.log('read ok:',f)"
```

Then confirm structure by eye against the files above. If `yq` or `python` with PyYAML is available, prefer a real parse:

```bash
python -c "import yaml,sys; [yaml.safe_load(open(f)) for f in ['.github/dependabot.yml','.github/workflows/audit.yml','.github/workflows/ci.yml']]; print('yaml ok')"
```

- [ ] **Step 5: Verify the local commands the workflows call**

```bash
npm run lint
npm audit --audit-level=moderate
```

Expected: lint clean; audit reports `found 0 vulnerabilities`.

- [ ] **Step 6: Commit**

```bash
git add .github/dependabot.yml .github/workflows/audit.yml .github/workflows/ci.yml
git commit -m "ci: add Dependabot, a weekly audit issue, and a lint gate

Dependabot watches npm, github-actions, and the dotnet NuGet project, which was
previously unwatched despite shipping to NuGet from publish.yml.

The audit never blocks CI. Visibility comes from a weekly job that opens an issue,
following the check-docs.yml pattern, so an advisory with no upstream fix cannot
lock unrelated PRs.

Lint does block: it is deterministic and fully under this repo's control."
```

- [ ] **Step 7: Confirm the audit workflow runs green once pushed**

After pushing, trigger it manually:

```bash
gh workflow run audit.yml
gh run list --workflow=audit.yml --limit 1
```

Expected: the run succeeds and opens no issue, because the audit is clean.

---

### Task 7: Raise the Node floor and release 0.9.0

The package claims `>=18`, tests one unpinned `lts/*`, and ships a `node:20` image. Node 18 reached end of life in April 2025, so the claim promises support for an unmaintained runtime. Five files must agree.

**Files:**
- Modify: `package.json` (`engines.node`, `version`)
- Modify: `.github/workflows/ci.yml` (matrix)
- Modify: `.github/workflows/publish.yml:25` (`lts/*` -> `24`)
- Modify: `.github/workflows/check-docs.yml:18` (`lts/*` -> `24`)
- Modify: `Dockerfile:5` and `Dockerfile:11` (`node:20-alpine` -> `node:22-alpine`)
- Modify: `README.md` (requirements note)

**Interfaces:**
- Consumes: `ci.yml` as modified by Task 6.
- Produces: the 0.9.0 release.

- [ ] **Step 1: Raise the engines floor**

In `package.json`:

```json
"engines": {
  "node": ">=20"
},
```

- [ ] **Step 2: Add the CI matrix**

Rewrite the `build` job in `.github/workflows/ci.yml` so it runs across all three supported versions. Keep the lint and audit steps added in Task 6:

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        node-version: [20, 22, 24]
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: ${{ matrix.node-version }}
      - run: npm ci
      - run: npm run lint
      - name: Audit (report only, never blocks)
        run: npm audit --audit-level=moderate
        continue-on-error: true
      - run: npm test
      - run: npm run build
      - run: npm run eval
      - run: npm run export
```

`fail-fast: false` so one Node version failing still reports the others — otherwise a single red cancels the runs that would tell you whether the problem is version-specific.

- [ ] **Step 3: Pin the other two workflows**

In `.github/workflows/publish.yml`, change `node-version: "lts/*"` to `node-version: "24"`.

In `.github/workflows/check-docs.yml`, change `node-version: "lts/*"` to `node-version: "24"`.

`lts/*` changes meaning over time, so a release can be built on a runtime nobody chose.

- [ ] **Step 4: Update the Dockerfile**

Change both stages from `FROM node:20-alpine` to `FROM node:22-alpine` (lines 5 and 11).

- [ ] **Step 5: Verify the container still builds and speaks MCP**

```bash
docker build -t partner-center-mcp:test .
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"1"}}}' | docker run -i --rm partner-center-mcp:test
```

Expected: a JSON-RPC response naming `partner-center-mcp`. If Docker is unavailable in the environment, skip this step and say so explicitly rather than marking it done.

- [ ] **Step 6: Note the requirement in the README**

In `README.md`, under the `## Run` section, state the requirement plainly:

```markdown
Requires Node.js 20 or newer. (0.9.0 dropped Node 18, which reached end of life in April 2025.)
```

- [ ] **Step 7: Verify everything locally**

```bash
npm run lint && npm run build && npm test && npm run eval && npm run export
```

Expected: all clean, 62 tests pass.

- [ ] **Step 8: Bump the version and commit**

```bash
npm version 0.9.0 --no-git-tag-version
git add package.json package-lock.json Dockerfile README.md .github/workflows/ci.yml .github/workflows/publish.yml .github/workflows/check-docs.yml
git commit -m "chore(release)!: require Node 20+, test on 20/22/24, release 0.9.0

BREAKING CHANGE: engines.node moves from >=18 to >=20. Node 18 reached end of
life in April 2025, so the old floor promised support for an unmaintained runtime.

CI now runs a real 20/22/24 matrix instead of a single unpinned lts/*, and
publish.yml and check-docs.yml pin Node 24 so a release is never built on a
runtime nobody chose. The container moves to node:22-alpine."
```

- [ ] **Step 9: Do not tag or push the release without confirming with the user**

Tagging `v0.9.0` triggers `publish.yml`, which publishes to npm, the MCP Registry, and NuGet. Stop here and confirm before running:

```bash
git tag v0.9.0 && git push origin v0.9.0
```

---

## Post-plan follow-ups

Out of scope here, recorded so they are not lost:

1. **Set the coverage threshold.** Task 5 measures only. Once the baseline is known, set `coverage.thresholds` to that number.
2. **Sub-project B: major upgrades.** `zod` 3 -> 4 (the SDK already accepts `^3.25 || ^4.0`), TypeScript 5.9 -> 7, `@types/node` 20 -> 26. Deliberately after this plan, so the lint, coverage, and matrix built here catch what the upgrades break.
3. **Revisit the `@hono/node-server` override.** It forces a major above the SDK's declared `^1.19.9`. When Dependabot raises an SDK update, check whether the override is still needed or has become harmful. Two tripwires, covering different failures: `test/http.test.ts` catches an override that breaks the transport; `npm audit` catches one that goes missing or stale.
