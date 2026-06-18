# partner-center-mcp — Design

Date: 2026-06-19

## Goal

A coding/knowledge assistant for the Microsoft Partner Center **REST API**, delivered as an
MCP server so it plugs into GitHub Copilot (VS Code, Visual Studio, Codespaces) and any
other MCP host (Claude Code, etc.). It answers Partner Center API questions, generates
correct request code, explains auth, decodes error codes, and migrates legacy SDK code —
all grounded in current Microsoft documentation.

The project exists because the Partner Center **.NET SDK (3.4.0) was archived in June 2023**;
Microsoft now directs partners to the REST APIs. Yet legacy SDK code and deprecated auth
patterns (e.g. `graph.windows.net` audience tokens, retired August 2025) are everywhere.
A general docs assistant won't reliably steer away from them. This server bakes in curated
Partner Center expertise that does.

## Non-goals

- **No operational API calls.** The server never holds credentials, never calls live
  Partner Center APIs, never performs CSP operations. It is a knowledge/codegen assistant
  only. (An operational tool is a possible future project with a very different security
  profile.)
- **No archived .NET SDK output.** Generated code always uses the current REST API.
- **No reimplementation of general docs search.** The existing Microsoft Learn MCP server
  covers broad doc search; this server is the curated, opinionated Partner Center layer and
  composes alongside it.

## Architecture

- **Type:** stdio MCP server built on `@modelcontextprotocol/sdk` in TypeScript/Node.
- **Distribution:** `npx partner-center-mcp`; published to npm with a `bin` entry.
- **Grounding (hybrid):** a small, curated **core knowledge pack** (bundled, versioned JSON;
  every record carries `docUrl` + `lastVerified`) plus **live doc fetch** for depth. Fast,
  current, and opinionated.
- **Data flow:** host → MCP tool call → server reads the curated pack → optionally enriches
  via live doc fetch → returns a structured, source-linked result. All generated/quoted
  code uses the current REST pattern and never recommends the archived SDK.
- **No credentials, no network identity.** The only outbound network is read-only doc
  fetching against learn.microsoft.com.

## Tools

Ten tools in five categories. Each has one clear responsibility, a `zod`-validated input
schema, and a structured result. Every result carries provenance (`docUrl`, `lastVerified`).

### A. Discovery & knowledge
- **`pc_list_scenarios`** — Input: `area?` (`customers` | `subscriptions` | `orders` |
  `licenses` | `invoicing` | `profiles` | `auth`). Output: `[{ id, title, area, method,
  path, authType, docUrl }]`. Source: curated pack.
- **`pc_get_scenario`** — Input: `id`, `enrich?` (bool). Output: full record — `method`,
  `path` (+ cloud base URL), `authType`, headers (required/optional + notes), request &
  response shape (annotated), ready examples (`curl`/`csharp`/`typescript`), `gotchas[]`,
  `docUrl`, `lastVerified`. With `enrich:true`, adds the latest notes via live doc fetch.
- **`pc_search_docs`** — Input: `query`, `topK?`. Output: excerpts + URLs scoped to Partner
  Center developer docs. Source: live (the "depth" half of the hybrid).

### B. Authentication (deprecation-aware — the highest-pain area)
- **`pc_auth_guidance`** — Input: `authType` (`app-only` | `app+user`), `cloud?`
  (`commercial` | `china-21vianet` | `us-gov`). Output: Entra app registration steps, the
  correct token request (`resource=api.partnercenter.microsoft.com`, correct national-cloud
  audience), secure app model + MFA enforcement timeline (App+User enforced 2026-04-01),
  which operations require app+user vs app-only, and deprecation warnings (graph.windows.net
  retired).
- **`pc_check_auth`** *(linter — differentiator)* — Input: `code` (an auth snippet).
  Output: detected deprecated/breaking patterns (`graph.windows.net` resource, legacy
  `generatetoken`, Azure AD Graph, missing MFA) with a fix and doc link for each. Prevents
  the 401/900420 class of failures proactively.

### C. Code generation & migration
- **`pc_generate_call`** — Input: `id` (or natural-language operation), `language`
  (`curl` | `csharp` | `typescript` | `powershell`), `options?` (pagination, correlation-id,
  locale, retry). Output: a complete, current REST call including auth, headers, body, and
  error handling. Never emits the archived SDK.
- **`pc_migrate_from_sdk`** *(headline feature)* — Input: `code` (legacy Partner Center
  .NET SDK code, e.g. `partnerOperations.Customers.ById(id).Subscriptions.Get()`). Output:
  the equivalent current REST call(s) + auth differences + caveats. Combines `sdk-map.json`
  pattern matching with model reasoning.

### D. Errors & troubleshooting
- **`pc_lookup_error`** — Input: `code` (e.g. `900420`) or `httpStatus`. Output:
  description, likely cause(s), remediation, `docUrl`. Source: curated error table.
- **`pc_diagnose`** — Input: `symptom` (natural language, e.g. "getting 401, token is new").
  Output: most likely cause → step-by-step fix + pointers to the relevant scenario/auth
  tools.

### E. Reference
- **`pc_get_reference`** — Input: `topic` (`base-urls` | `headers` | `versioning` |
  `sandbox` | `rate-limits`). Output: per-cloud base URLs, required REST headers
  (correlation-id, locale, authorization), API versioning, integration sandbox setup.

**Headline differentiators:** `pc_migrate_from_sdk` (archived SDK → REST) and
`pc_check_auth` (deprecation linter) — work the general Learn MCP cannot do without curated
expertise.

YAGNI note: `pc_generate_call` overlaps with the examples embedded in `pc_get_scenario`;
it is kept because it covers arbitrary languages and option toggles (pagination/retry) that
static examples don't. If it proves redundant in practice, fold it into `pc_get_scenario`.

## Knowledge pack model (`data/`)

Bundled, version-dated JSON, validated with `zod` at startup. Every record carries `docUrl`
+ `lastVerified`.

- **`scenarios.json`** — `{ id, area, title, method, path, authType, headers[],
  requestShape, responseShape, examples{curl,csharp,typescript}, gotchas[], docUrl,
  lastVerified }`. Used by list/get/generate.
- **`errors.json`** — `{ httpStatus, errorCode, description, causes[], remediation,
  docUrl }`. Used by lookup_error/diagnose.
- **`auth.json`** — `clouds{commercial, china-21vianet, us-gov}`, `patterns{app-only,
  app+user}` (steps, tokenRequest, secureAppModel, `mfa.enforcementDate`),
  `deprecations[]`. Used by auth_guidance/check_auth.
- **`sdk-map.json`** — `{ sdkPattern, restScenarioId, notes }`. Used by migrate_from_sdk.
- **`reference.json`** — base URLs, headers, versioning, sandbox. Used by get_reference.

## Project structure

```
partner-center-mcp/
  src/
    index.ts              # stdio MCP server bootstrap, bin entry
    server.ts             # registers the ten tools
    knowledge/
      types.ts            # Scenario, ErrorEntry, AuthPattern, ... types + zod schemas
      load.ts             # load + validate bundled JSON at startup
    tools/
      listScenarios.ts getScenario.ts searchDocs.ts
      authGuidance.ts checkAuth.ts
      generateCall.ts migrateFromSdk.ts
      lookupError.ts diagnose.ts getReference.ts
    docs/fetch.ts         # live doc fetch (search_docs + enrich); bounded timeout
    util/result.ts        # standard tool result/error shaping
  data/
    scenarios.json errors.json auth.json sdk-map.json reference.json
  test/*.test.ts
  package.json tsconfig.json README.md
```

Dependencies: `@modelcontextprotocol/sdk`, `zod`. Tests: `vitest`.

## Error handling

- **Startup:** all JSON validated against zod schemas; a malformed record fails fast with a
  clear message (CI catches drift).
- **Input:** per-tool zod validation; invalid input → structured error result, never a
  crash.
- **Not found:** unknown scenario id / error code → a "not found" result with closest-match
  suggestions.
- **Live fetch:** network failure or timeout → graceful degradation to curated content plus
  a "live fetch unavailable" note; the tool never crashes. Timeout is bounded.
- Every response includes `docUrl` + `lastVerified` so the answer can be trusted/verified.

## Testing strategy

- **Unit:** each tool against fixture knowledge — list/get/lookup deterministic;
  `check_auth` detects known deprecated patterns; `migrate_from_sdk` maps known SDK
  patterns; `lookup_error` resolves known codes.
- **Knowledge validation:** all bundled JSON parses against the schemas (guards against bad
  edits).
- **Freshness:** every record has `lastVerified`.
- **Live fetch:** mocked in tests (CI runs offline).
- **MCP smoke:** the server starts, lists ten tools, and a sample call returns a valid
  result shape.

## Distribution & maintenance

- `npx partner-center-mcp` (stdio). README documents three host setups — VS Code
  (`.vscode/mcp.json`), Visual Studio (`.mcp.json`), Claude Code (`claude mcp add`) — plus a
  note to add the Microsoft Learn MCP server alongside for broad doc search.
- The knowledge pack is date-versioned; `lastVerified` + `docUrl` per record make refresh
  auditable. An automated refresh script is out of scope for v1 (YAGNI) and can be added
  later.

## Rollout

Build in dependency order: knowledge schemas + loader → curated data → discovery tools →
auth tools → codegen/migration tools → error/reference tools → live fetch → packaging and
host config. Each tool ships with its tests; `vitest` green throughout.
