# CI & Supply-Chain Hardening — Design

Date: 2026-07-27
Status: Approved
Scope: sub-project A of three (A: CI/supply-chain, B: major dependency upgrades, C: product/feature work)

## Problem

Two moderate advisories reached `master` and were found by hand, not by the pipeline:

| Package | Advisory | How it arrived |
| --- | --- | --- |
| `@hono/node-server` `<2.0.5` | [GHSA-frvp-7c67-39w9](https://github.com/advisories/GHSA-frvp-7c67-39w9) — path traversal in `serve-static` on Windows via encoded backslash (`%5C`) | transitive via `@modelcontextprotocol/sdk`, which declares `^1.19.9`; all of 1.x is affected and no 1.x patch exists |
| `esbuild` `<=0.24.2` | GHSA-67mh-4wv8-2f99 — dev server request vulnerability | transitive via `vitest@2` (dev-only) |

Fixes are already in the working tree but uncommitted: `vitest ^2.0.0 -> ^4.1.10`, and
`overrides: { "@hono/node-server": "^2.0.5" }`.

The advisory was not exploitable in this project — `src/http.ts` uses raw `node:http` and never
touches `serve-static`. The override is still correct: it clears the audit and protects consumers.

`CI` runs test, build, eval, and export. It has no audit gate, no dependency update automation, no
linter, no coverage measurement, and a single Node version. `src/http.ts` has zero test coverage,
and it is the one file the `@hono/node-server` override affects — the SDK's
`server/streamableHttp.js` imports `getRequestListener` from it, so a major-version override sits on
a live code path with nothing guarding it.

## Goals

1. Make the class of regression above visible without human initiative.
2. Cover the untested HTTP entry point, which doubles as the override's tripwire.
3. Add the quality floor the repo lacks (lint, format, coverage measurement) without meaningfully
   growing the dependency surface we just cleaned.
4. Align the Node support claim with what is actually tested.

## Non-goals

- Major dependency upgrades (`zod` 4, TypeScript 7, `@types/node` 26) — sub-project B.
- Any new MCP tool, scenario, or knowledge-pack content — sub-project C.
- Refactoring unrelated to the above.

## Design

### 1. Audit reporting (never blocks CI)

A `security-audit` job runs `npm audit --audit-level=moderate` but never fails the build. Visibility
comes from a scheduled job rather than a red check:

- In `ci.yml`: an audit step with `continue-on-error: true`, so the result is on every run but a
  finding never blocks an unrelated PR.
- A new `.github/workflows/audit.yml`, weekly plus `workflow_dispatch`, mirroring the existing
  `check-docs.yml` idiom: on findings it opens or comments on a single issue labelled
  `dependency-audit`, writing `npm audit`'s output into the body.

Rationale: a report-only step buried in CI logs is effectively invisible; routing it to an issue
preserves the "never break the build" decision while keeping the finding in front of a human. This
is the direct lesson of the `@hono/node-server` case, where no upstream fix existed and a blocking
gate would have locked every unrelated PR until someone hand-wrote an override.

### 2. Dependabot

`.github/dependabot.yml`, weekly, three ecosystems:

| Ecosystem | Directory | Notes |
| --- | --- | --- |
| `npm` | `/` | minor + patch grouped into one PR; majors separate (they belong to sub-project B) |
| `github-actions` | `/` | the workflows pin `actions/checkout@v5`, `actions/setup-node@v5`, `actions/setup-dotnet@v5` |
| `nuget` | `/dotnet` | `dotnet/PartnerCenterMcp` ships to NuGet from `publish.yml` and is currently unwatched |

Grouping minor/patch keeps PR volume low; separating majors keeps sub-project B's decisions
deliberate rather than arriving as surprise PRs.

### 3. Linter and formatter: Biome

Biome, configured in `biome.json`, providing lint and format from a single dependency.

Chosen over ESLint deliberately: `eslint` + `typescript-eslint` adds roughly a hundred transitive
packages to the dev tree — the same tree this sub-project exists to shrink and watch. Accepting that
surface to guard against supply-chain risk is self-defeating at this repo's size (27 source files,
two runtime dependencies).

The cost is real and accepted: Biome has no type-aware rules, so checks like `no-floating-promises`
are out of reach. Section 4 recovers part of that through the compiler instead.

- Ignore: `dist`, `node_modules`, `generated`, `data`, `dotnet`.
- Scripts: `lint` (`biome check .`) and `lint:fix` (`biome check --write .`).
- `ci.yml` runs `npm run lint`. Unlike audit, lint **does** block — it is deterministic and fully
  under this repo's control, so it cannot be red for reasons outside a contributor's power.

### 4. Compiler strictness

`tsconfig.json` is already `strict: true`. Add:

- `noUncheckedIndexedAccess` — the knowledge loaders in `src/knowledge/` index into parsed JSON,
  which is exactly where this flag pays.
- `noImplicitOverride`
- `verbatimModuleSyntax`

Expected churn: `verbatimModuleSyntax` requires type-only imports to be written `import type`, and
`noUncheckedIndexedAccess` will surface genuine `undefined` cases at index sites. Both land as their
own mechanical commit, separate from behavioural change, so review stays readable.

### 5. HTTP entry point: refactor for testability, then test it

`src/http.ts` currently builds its server and calls `listen()` at module scope, so importing it
starts a server on a fixed port. It cannot be tested as written.

Split it along that seam:

- `src/http/app.ts` — exports `createHttpApp({ knowledge, docFetch, version })`, returning a
  configured `http.Server` that has **not** been told to listen. Holds all request routing:
  `/healthz`, `POST /mcp`, 404, 405.
- `src/http.ts` — thin bin entry: load knowledge, resolve port, call the factory, `listen()`.

This is the isolation the rest of `src/` already has (`src/server.ts` exports `createServer` rather
than self-starting), so it makes the HTTP path consistent with the stdio path.

Then `test/http.test.ts` drives a real server on port `0`:

| Case | Expectation |
| --- | --- |
| `GET /healthz` | `200`, `{ ok: true, version }` |
| `POST /mcp` `initialize` | `200`, JSON-RPC result with `serverInfo.name === "partner-center-mcp"` |
| `POST /mcp` `tools/list` | `200`, non-empty `tools` array |
| `GET /unknown` | `404` |
| `GET /mcp` | `405` with an `Allow: POST` header |

The `initialize` and `tools/list` cases are what make this the override's regression test: both run
through the SDK's `StreamableHTTPServerTransport`, which calls `getRequestListener` from
`@hono/node-server`. If a future SDK or override change breaks that resolution, these fail. This
automates the manual smoke test that verified the v2 override.

### 6. Coverage measurement

Add `@vitest/coverage-v8` and enable the v8 provider in `vitest.config.ts` with `text` and `lcov`
reporters. **No threshold in this sub-project.** Measure first — with `test/http.test.ts` landed —
then set the floor at the observed number in a follow-up, so it can only ratchet upward. Setting a
number before knowing the baseline invites either a meaningless floor or an immediate failure.

### 7. Node baseline

The package claims `>=18`, tests one unpinned `lts/*`, and ships a `node:20` image. Node 18 reached
end of life in April 2025, so the claim promises support for an unmaintained runtime.

Move the floor to 20 and test it honestly. Five places must agree:

| File | Change |
| --- | --- |
| `package.json` | `engines.node`: `>=18` -> `>=20` |
| `.github/workflows/ci.yml` | matrix `node-version: [20, 22, 24]` |
| `.github/workflows/publish.yml` | `lts/*` -> pinned `24` |
| `.github/workflows/check-docs.yml` | `lts/*` -> pinned `24` |
| `Dockerfile` | `node:20-alpine` -> `node:22-alpine` (both stages) |

Pinning the publish and doc-check workflows removes a silent drift source: `lts/*` changes meaning
over time, so a release can be built on a runtime nobody chose.

Raising `engines` is breaking for consumers, so this ships as **0.9.0** with a README note.

## Sequencing

Each step is independently committable and leaves the tree green.

1. Land the pending security fix (`vitest@4` + `@hono/node-server` override). Already verified:
   build passes, 57 tests pass, HTTP transport smoke-tested by hand.
2. Refactor `src/http.ts` into factory + entry, add `test/http.test.ts`. Closes the coverage gap and
   replaces step 1's manual verification with an automated one.
3. Add Biome; land its mechanical fixes as a separate commit.
4. Tighten `tsconfig.json`; land its fixes as a separate commit.
5. Add coverage measurement.
6. Add `dependabot.yml` and `audit.yml`; wire the non-blocking audit step and blocking lint step
   into `ci.yml`.
7. Node baseline bump across the five files; release as 0.9.0.

Step 2 precedes 3 and 4 on purpose: the linter and the stricter compiler will both touch
`src/http.ts`, and doing so with tests already in place is safer than without.

## Risks

- **`verbatimModuleSyntax` churn.** Touches import statements across `src/`. Mitigated by isolating
  it in its own commit and relying on the existing 57 tests plus the new HTTP test.
- **Biome's first run may flag many files.** Same mitigation: one mechanical commit, no behavioural
  change mixed in.
- **The `@hono/node-server` override is a standing liability.** It forces a major above what the SDK
  declares (`^1.19.9`). If the SDK moves to hono v3, or widens its range, the override could silently
  pin a stale version. Two different tripwires cover two different failures, and neither covers both:
  `test/http.test.ts` catches an override that *breaks* the transport, while `npm audit` catches an
  override that goes *missing* or stale. Note that deleting the override would resolve
  `@hono/node-server` back to a working v1.x, so the HTTP test would still pass — only the audit
  would notice. Dependabot surfaces SDK updates for a human to re-evaluate the override against.
- **Dropping Node 18 is breaking.** Deliberate, and the reason this ships as 0.9.0 rather than a
  patch.
- **Report-only audit depends on the weekly issue actually being read.** Accepted trade-off for never
  blocking CI; the issue-per-finding pattern is already proven in this repo by `check-docs.yml`.

## Verification

The work is done when, on a clean checkout:

- `npm ci && npm run lint && npm run build && npm test` passes on Node 20, 22, and 24.
- `npm audit` reports zero vulnerabilities, and the audit workflow runs green on a
  `workflow_dispatch` trigger.
- `test/http.test.ts` passes, exercising `initialize` and `tools/list` through
  `StreamableHTTPServerTransport` — the path that calls `getRequestListener`.
- Coverage output includes `src/http/app.ts` at non-zero coverage.
