# partner-center-mcp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a TypeScript stdio MCP server that is a knowledge/codegen assistant for the Partner Center REST API, grounded in a curated knowledge pack plus live doc fetch.

**Architecture:** Each tool is an SDK-agnostic module exporting `{ name, description, inputShape (zod raw shape), run(args, ctx) }`. `server.ts` adapts these onto `@modelcontextprotocol/sdk`'s `McpServer.registerTool`. A `ToolContext` carries the validated knowledge pack and a bounded `docFetch`. Unit tests call `run()` directly with fixture knowledge; no transport needed.

**Tech Stack:** Node 18+ (global `fetch`), TypeScript (ESM, NodeNext), `@modelcontextprotocol/sdk`, `zod`, `vitest`.

## Global Constraints

- No credentials, no live Partner Center API calls, no CSP operations — knowledge/codegen only.
- Generated/quoted code uses the current REST API; never the archived .NET SDK.
- Runtime dependencies limited to `@modelcontextprotocol/sdk` and `zod`. Dev: `typescript`, `vitest`, `@types/node`.
- Package is ESM (`"type": "module"`); TypeScript `module`/`moduleResolution` = `NodeNext`.
- Every knowledge record carries `docUrl` and `lastVerified` (ISO date string).
- Auth correctness anchors (verbatim): token resource is `https://api.partnercenter.microsoft.com`; `https://graph.windows.net` audience is retired (Aug 2025); App+User MFA enforced 2026-04-01.
- `npx vitest run` must stay green after every task. Commit after each task.

## File Structure

```
partner-center-mcp/
  package.json tsconfig.json vitest.config.ts
  src/
    index.ts              # stdio bootstrap (bin)
    server.ts             # createServer(): adapts tools onto McpServer
    types.ts              # Tool, ToolContext, ToolResult
    knowledge/
      schema.ts           # zod schemas + inferred types for the pack
      load.ts             # loadKnowledge(dir) -> validated Knowledge
    docs/fetch.ts         # makeDocFetch(): bounded, graceful live fetch
    util/result.ts        # ok(), notFound(), toolError()
    tools/
      listScenarios.ts getScenario.ts searchDocs.ts
      authGuidance.ts checkAuth.ts
      generateCall.ts migrateFromSdk.ts
      lookupError.ts diagnose.ts getReference.ts
      index.ts            # array of all tools
  data/
    scenarios.json errors.json auth.json sdk-map.json reference.json
  test/
    *.test.ts
    fixtures/             # minimal valid pack for unit tests
  README.md
```

---

### Task 1: Project scaffold and empty server

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`
- Create: `src/types.ts`, `src/server.ts`, `src/index.ts`, `src/tools/index.ts`
- Test: `test/server.test.ts`

**Interfaces:**
- Produces:
  - `types.ts`: `ToolResult = { ok: boolean; data?: unknown; error?: string; suggestions?: string[] }`; `ToolContext = { knowledge: Knowledge; docFetch: DocFetch }`; `Tool = { name: string; description: string; inputShape: z.ZodRawShape; run(args: any, ctx: ToolContext): Promise<ToolResult> | ToolResult }`. (`Knowledge` and `DocFetch` are defined in later tasks; for now type them as `any` via `import type` placeholders declared here.)
  - `server.ts`: `createServer(tools: Tool[], ctx: ToolContext): McpServer`.
  - `tools/index.ts`: `export const allTools: Tool[] = []` (filled in later tasks).

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "partner-center-mcp",
  "version": "0.1.0",
  "description": "MCP server: knowledge and codegen assistant for the Partner Center REST API",
  "type": "module",
  "bin": { "partner-center-mcp": "dist/index.js" },
  "files": ["dist", "data", "README.md"],
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "start": "node dist/index.js"
  },
  "engines": { "node": ">=18" },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "declaration": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "esModuleInterop": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["test/**/*.test.ts"] },
});
```

- [ ] **Step 4: Create `src/types.ts`**

```ts
import type { z } from "zod";

// Knowledge and DocFetch get concrete types in later tasks; widen here so this
// foundational module does not depend on them.
export type Knowledge = unknown;
export type DocFetch = (query: string, opts?: { timeoutMs?: number }) =>
  Promise<{ ok: boolean; excerpts: { title: string; url: string; text: string }[]; note?: string }>;

export interface ToolContext {
  knowledge: Knowledge;
  docFetch: DocFetch;
}

export interface ToolResult {
  ok: boolean;
  data?: unknown;
  error?: string;
  suggestions?: string[];
}

export interface Tool {
  name: string;
  description: string;
  inputShape: z.ZodRawShape;
  run(args: any, ctx: ToolContext): Promise<ToolResult> | ToolResult;
}
```

- [ ] **Step 5: Create `src/server.ts`**

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Tool, ToolContext } from "./types.js";

export function createServer(tools: Tool[], ctx: ToolContext): McpServer {
  const server = new McpServer({ name: "partner-center-mcp", version: "0.1.0" });
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputShape },
      async (args: unknown) => {
        const result = await tool.run(args, ctx);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result as Record<string, unknown>,
        };
      },
    );
  }
  return server;
}
```

- [ ] **Step 6: Create `src/tools/index.ts`**

```ts
import type { Tool } from "../types.js";

export const allTools: Tool[] = [];
```

- [ ] **Step 7: Create `src/index.ts`**

```ts
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createServer } from "./server.js";
import { allTools } from "./tools/index.js";
import { loadKnowledge } from "./knowledge/load.js";
import { makeDocFetch } from "./docs/fetch.js";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, "..", "data");

const knowledge = loadKnowledge(dataDir);
const ctx = { knowledge, docFetch: makeDocFetch() };
const server = createServer(allTools, ctx);
await server.connect(new StdioServerTransport());
```

Note: `index.ts` imports `loadKnowledge` and `makeDocFetch`, created in Tasks 2 and 4. It will not run until those exist; that is fine — it is not imported by tests, and `npm run build` is not part of this task's gate. The test below imports only `server.ts`.

- [ ] **Step 8: Write the failing test**

Create `test/server.test.ts`:

```ts
import { test, expect } from "vitest";
import { createServer } from "../src/server.js";
import type { Tool, ToolContext } from "../src/types.js";

const ctx: ToolContext = { knowledge: {}, docFetch: async () => ({ ok: true, excerpts: [] }) };

test("createServer registers each provided tool", async () => {
  const tool: Tool = {
    name: "ping",
    description: "test tool",
    inputShape: {},
    run: () => ({ ok: true, data: "pong" }),
  };
  const server = createServer([tool], ctx);
  expect(server).toBeDefined();
  // McpServer exposes registered tools internally; assert no throw and a server object.
});

test("createServer with no tools returns a server", () => {
  expect(createServer([], ctx)).toBeDefined();
});
```

- [ ] **Step 9: Install deps and run the test to verify it passes**

Run: `npm install && npx vitest run test/server.test.ts`
Expected: 2 tests pass. (If `@modelcontextprotocol/sdk` registerTool signature differs in the installed version, adjust `server.ts` per its types — the adapter is the only coupling point.)

- [ ] **Step 10: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts src test
git commit -m "feat: scaffold MCP server with tool adapter"
```

---

### Task 2: Knowledge schema, loader, result helpers

**Files:**
- Create: `src/knowledge/schema.ts`, `src/knowledge/load.ts`, `src/util/result.ts`
- Modify: `src/types.ts` (replace the placeholder `Knowledge`/`DocFetch` types with real imports)
- Test: `test/knowledge.test.ts`
- Test fixtures: `test/fixtures/*.json`

**Interfaces:**
- Consumes: `ToolResult` from `types.ts`.
- Produces:
  - `schema.ts`: zod schemas `ScenarioSchema`, `ErrorEntrySchema`, `AuthSchema`, `SdkMapSchema`, `ReferenceSchema`, and `KnowledgeSchema`; inferred types `Scenario`, `ErrorEntry`, `AuthData`, `SdkMapping`, `ReferenceData`, `Knowledge`.
  - `load.ts`: `loadKnowledge(dir: string): Knowledge` — reads the five JSON files, validates, throws `Error` with the file + zod message on failure.
  - `result.ts`: `ok(data)`, `notFound(error, suggestions?)`, `toolError(error)` returning `ToolResult`.

- [ ] **Step 1: Write the failing test**

Create `test/fixtures/scenarios.json`:

```json
{ "version": "test", "scenarios": [
  { "id": "verify-mpn", "area": "profiles", "title": "Verify a partner by MPN id",
    "method": "GET", "path": "/v1/profiles/mpn?mpnId={mpn-id}", "authType": "app+user",
    "headers": [{ "name": "Authorization", "required": true, "note": "Bearer token" }],
    "requestShape": null, "responseShape": "MpnProfile",
    "examples": { "curl": "curl ...", "csharp": "// ...", "typescript": "// ..." },
    "gotchas": [], "docUrl": "https://learn.microsoft.com/partner-center/developer/get-partner-by-mpn-id",
    "lastVerified": "2026-06-18" }
] }
```

Create `test/fixtures/errors.json`:

```json
{ "version": "test", "errors": [
  { "httpStatus": 401, "errorCode": "900420", "description": "Token audience invalid / retired.",
    "causes": ["graph.windows.net audience token"], "remediation": "Use api.partnercenter.microsoft.com audience.",
    "docUrl": "https://learn.microsoft.com/partner-center/developer/error-codes" }
] }
```

Create `test/fixtures/auth.json`:

```json
{ "version": "test",
  "clouds": { "commercial": { "tokenResource": "https://api.partnercenter.microsoft.com", "authority": "https://login.microsoftonline.com" } },
  "patterns": {
    "app-only": { "steps": ["Register a web app in Entra"], "tokenRequest": "resource=https://api.partnercenter.microsoft.com&grant_type=client_credentials", "supportedNote": "Not all operations support app-only." },
    "app+user": { "steps": ["Use the secure application model"], "secureAppModel": "Required", "mfa": { "enforcementDate": "2026-04-01", "note": "MFA enforced for App+User." } }
  },
  "deprecations": [ { "what": "graph.windows.net audience", "status": "retired 2025-08", "fix": "Use api.partnercenter.microsoft.com." } ] }
```

Create `test/fixtures/sdk-map.json`:

```json
{ "version": "test", "mappings": [
  { "sdkPattern": "Customers.ById({id}).Subscriptions.Get()", "restScenarioId": "list-customer-subscriptions", "notes": "GET /v1/customers/{id}/subscriptions" }
] }
```

Create `test/fixtures/reference.json`:

```json
{ "version": "test",
  "baseUrls": { "commercial": "https://api.partnercenter.microsoft.com" },
  "headers": [ { "name": "MS-CorrelationId", "purpose": "Trace a request" } ],
  "versioning": "Paths are prefixed with /v1.",
  "sandbox": "Use the integration sandbox for testing.",
  "rateLimits": "Honor 429 Retry-After." }
```

Create `test/knowledge.test.ts`:

```ts
import { test, expect } from "vitest";
import { loadKnowledge } from "../src/knowledge/load.js";
import { ok, notFound } from "../src/util/result.js";

test("loadKnowledge validates and returns the pack", () => {
  const k = loadKnowledge("test/fixtures");
  expect(k.scenarios[0].id).toBe("verify-mpn");
  expect(k.errors[0].errorCode).toBe("900420");
  expect(k.auth.patterns["app+user"].mfa.enforcementDate).toBe("2026-04-01");
  expect(k.reference.baseUrls.commercial).toContain("api.partnercenter.microsoft.com");
});

test("loadKnowledge throws a clear error on a malformed file", () => {
  expect(() => loadKnowledge("test/fixtures-bad")).toThrow(/scenarios\.json/);
});

test("result helpers shape ToolResult", () => {
  expect(ok({ a: 1 })).toEqual({ ok: true, data: { a: 1 } });
  expect(notFound("nope", ["x"])).toEqual({ ok: false, error: "nope", suggestions: ["x"] });
});
```

Create `test/fixtures-bad/scenarios.json` (invalid — missing required fields) and copies of the other four valid files:

```json
{ "version": "bad", "scenarios": [ { "id": "x" } ] }
```

(Copy the four valid `errors.json`, `auth.json`, `sdk-map.json`, `reference.json` from `test/fixtures` into `test/fixtures-bad` so only `scenarios.json` is malformed.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/knowledge.test.ts`
Expected: FAIL — `loadKnowledge`/`ok`/`notFound` not found.

- [ ] **Step 3: Create `src/knowledge/schema.ts`**

```ts
import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "lastVerified must be YYYY-MM-DD");

export const ScenarioSchema = z.object({
  id: z.string(),
  area: z.enum(["customers", "subscriptions", "orders", "licenses", "invoicing", "profiles", "auth"]),
  title: z.string(),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  path: z.string(),
  authType: z.enum(["app-only", "app+user"]),
  headers: z.array(z.object({ name: z.string(), required: z.boolean(), note: z.string().optional() })),
  requestShape: z.union([z.string(), z.null()]),
  responseShape: z.union([z.string(), z.null()]),
  examples: z.object({ curl: z.string(), csharp: z.string(), typescript: z.string() }),
  gotchas: z.array(z.string()),
  docUrl: z.string().url(),
  lastVerified: isoDate,
});

export const ErrorEntrySchema = z.object({
  httpStatus: z.number(),
  errorCode: z.string(),
  description: z.string(),
  causes: z.array(z.string()),
  remediation: z.string(),
  docUrl: z.string().url(),
});

export const AuthSchema = z.object({
  clouds: z.record(z.object({ tokenResource: z.string(), authority: z.string() })),
  patterns: z.object({
    "app-only": z.object({ steps: z.array(z.string()), tokenRequest: z.string(), supportedNote: z.string() }),
    "app+user": z.object({ steps: z.array(z.string()), secureAppModel: z.string(), mfa: z.object({ enforcementDate: z.string(), note: z.string() }) }),
  }),
  deprecations: z.array(z.object({ what: z.string(), status: z.string(), fix: z.string() })),
});

export const SdkMapSchema = z.object({
  mappings: z.array(z.object({ sdkPattern: z.string(), restScenarioId: z.string(), notes: z.string() })),
});

export const ReferenceSchema = z.object({
  baseUrls: z.record(z.string()),
  headers: z.array(z.object({ name: z.string(), purpose: z.string() })),
  versioning: z.string(),
  sandbox: z.string(),
  rateLimits: z.string(),
});

export type Scenario = z.infer<typeof ScenarioSchema>;
export type ErrorEntry = z.infer<typeof ErrorEntrySchema>;
export type AuthData = z.infer<typeof AuthSchema>;
export type SdkMapping = z.infer<typeof SdkMapSchema>["mappings"][number];
export type ReferenceData = z.infer<typeof ReferenceSchema>;

export interface Knowledge {
  scenarios: Scenario[];
  errors: ErrorEntry[];
  auth: AuthData;
  sdkMap: SdkMapping[];
  reference: ReferenceData;
}
```

- [ ] **Step 4: Create `src/knowledge/load.ts`**

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  ScenarioSchema, ErrorEntrySchema, AuthSchema, SdkMapSchema, ReferenceSchema, type Knowledge,
} from "./schema.js";

function read<T>(dir: string, file: string, schema: z.ZodType<T>): T {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(join(dir, file), "utf8"));
  } catch (e) {
    throw new Error(`${file}: cannot read or parse (${(e as Error).message})`);
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new Error(`${file}: invalid (${result.error.issues[0].path.join(".")}: ${result.error.issues[0].message})`);
  }
  return result.data;
}

export function loadKnowledge(dir: string): Knowledge {
  const scenarios = read(dir, "scenarios.json", z.object({ version: z.string(), scenarios: z.array(ScenarioSchema) })).scenarios;
  const errors = read(dir, "errors.json", z.object({ version: z.string(), errors: z.array(ErrorEntrySchema) })).errors;
  const auth = read(dir, "auth.json", AuthSchema.extend({ version: z.string() }));
  const sdkMap = read(dir, "sdk-map.json", SdkMapSchema.extend({ version: z.string() })).mappings;
  const reference = read(dir, "reference.json", ReferenceSchema);
  return { scenarios, errors, auth, sdkMap, reference };
}
```

- [ ] **Step 5: Create `src/util/result.ts`**

```ts
import type { ToolResult } from "../types.js";

export const ok = (data: unknown): ToolResult => ({ ok: true, data });
export const notFound = (error: string, suggestions?: string[]): ToolResult =>
  suggestions ? { ok: false, error, suggestions } : { ok: false, error };
export const toolError = (error: string): ToolResult => ({ ok: false, error });
```

- [ ] **Step 6: Update `src/types.ts` to use the real `Knowledge` type**

Replace the placeholder block:

```ts
export type Knowledge = unknown;
```

with:

```ts
import type { Knowledge } from "./knowledge/schema.js";
export type { Knowledge };
```

(Keep the `DocFetch`, `ToolContext`, `ToolResult`, `Tool` definitions as-is.)

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run test/knowledge.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 8: Commit**

```bash
git add src/knowledge src/util/result.ts src/types.ts test
git commit -m "feat: knowledge schema, validating loader, result helpers"
```

---

### Task 3: Curated data pack

**Files:**
- Create: `data/scenarios.json`, `data/errors.json`, `data/auth.json`, `data/sdk-map.json`, `data/reference.json`
- Test: `test/data.test.ts`

**Interfaces:**
- Consumes: `loadKnowledge` from Task 2.
- Produces: the real, shipped knowledge pack. Scenario ids used downstream: `verify-mpn`, `assign-licenses`, `list-customer-subscriptions`.

- [ ] **Step 1: Write the failing test**

Create `test/data.test.ts`:

```ts
import { test, expect } from "vitest";
import { loadKnowledge } from "../src/knowledge/load.js";

const k = loadKnowledge("data");

test("real pack validates and has the seed scenarios", () => {
  const ids = k.scenarios.map((s) => s.id);
  expect(ids).toContain("verify-mpn");
  expect(ids).toContain("assign-licenses");
  expect(ids).toContain("list-customer-subscriptions");
});

test("real pack carries the retired-token error and current auth resource", () => {
  expect(k.errors.find((e) => e.errorCode === "900420")).toBeTruthy();
  expect(k.auth.clouds.commercial.tokenResource).toBe("https://api.partnercenter.microsoft.com");
  expect(k.auth.patterns["app+user"].mfa.enforcementDate).toBe("2026-04-01");
});

test("every record has docUrl and scenarios have lastVerified", () => {
  for (const s of k.scenarios) { expect(s.docUrl).toMatch(/^https:\/\//); expect(s.lastVerified).toMatch(/^\d{4}-\d{2}-\d{2}$/); }
  for (const e of k.errors) expect(e.docUrl).toMatch(/^https:\/\//);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/data.test.ts`
Expected: FAIL — `data/*.json` do not exist.

- [ ] **Step 3: Create `data/scenarios.json`** (real Partner Center REST scenarios)

```json
{
  "version": "2026-06",
  "scenarios": [
    {
      "id": "verify-mpn",
      "area": "profiles",
      "title": "Verify a partner by MPN id",
      "method": "GET",
      "path": "/v1/profiles/mpn?mpnId={mpn-id}",
      "authType": "app+user",
      "headers": [
        { "name": "Authorization", "required": true, "note": "Bearer token, audience https://api.partnercenter.microsoft.com" },
        { "name": "MS-CorrelationId", "required": false, "note": "GUID to trace the request" }
      ],
      "requestShape": null,
      "responseShape": "MpnProfile",
      "examples": {
        "curl": "curl -H \"Authorization: Bearer $TOKEN\" \"https://api.partnercenter.microsoft.com/v1/profiles/mpn?mpnId=1234567\"",
        "csharp": "using var http = new HttpClient { BaseAddress = new Uri(\"https://api.partnercenter.microsoft.com\") };\nhttp.DefaultRequestHeaders.Authorization = new(\"Bearer\", token);\nvar res = await http.GetAsync(\"/v1/profiles/mpn?mpnId=1234567\");",
        "typescript": "const res = await fetch(\"https://api.partnercenter.microsoft.com/v1/profiles/mpn?mpnId=1234567\", { headers: { Authorization: `Bearer ${token}` } });"
      },
      "gotchas": ["Omit mpnId to return the signed-in partner's profile."],
      "docUrl": "https://learn.microsoft.com/partner-center/developer/get-partner-by-mpn-id",
      "lastVerified": "2026-06-18"
    },
    {
      "id": "assign-licenses",
      "area": "licenses",
      "title": "Assign licenses to a user",
      "method": "POST",
      "path": "/v1/customers/{customer-id}/users/{user-id}/licenseupdates",
      "authType": "app+user",
      "headers": [
        { "name": "Authorization", "required": true, "note": "Bearer token, audience https://api.partnercenter.microsoft.com" },
        { "name": "Content-Type", "required": true, "note": "application/json" }
      ],
      "requestShape": "LicenseUpdate",
      "responseShape": "LicenseUpdate",
      "examples": {
        "curl": "curl -X POST -H \"Authorization: Bearer $TOKEN\" -H \"Content-Type: application/json\" -d @body.json \"https://api.partnercenter.microsoft.com/v1/customers/{customer-id}/users/{user-id}/licenseupdates\"",
        "csharp": "var res = await http.PostAsync($\"/v1/customers/{customerId}/users/{userId}/licenseupdates\", content);",
        "typescript": "const res = await fetch(`https://api.partnercenter.microsoft.com/v1/customers/${customerId}/users/${userId}/licenseupdates`, { method: \"POST\", headers: { Authorization: `Bearer ${token}`, \"Content-Type\": \"application/json\" }, body });"
      },
      "gotchas": ["Returns 201 with the LicenseUpdate resource on success.", "Fails if the license is not available in the customer tenant."],
      "docUrl": "https://learn.microsoft.com/partner-center/developer/assign-licenses-to-a-user",
      "lastVerified": "2026-06-18"
    },
    {
      "id": "list-customer-subscriptions",
      "area": "subscriptions",
      "title": "List a customer's subscriptions",
      "method": "GET",
      "path": "/v1/customers/{customer-id}/subscriptions",
      "authType": "app+user",
      "headers": [
        { "name": "Authorization", "required": true, "note": "Bearer token, audience https://api.partnercenter.microsoft.com" },
        { "name": "MS-CorrelationId", "required": false, "note": "GUID to trace the request" }
      ],
      "requestShape": null,
      "responseShape": "Subscription collection",
      "examples": {
        "curl": "curl -H \"Authorization: Bearer $TOKEN\" \"https://api.partnercenter.microsoft.com/v1/customers/{customer-id}/subscriptions\"",
        "csharp": "var res = await http.GetAsync($\"/v1/customers/{customerId}/subscriptions\");",
        "typescript": "const res = await fetch(`https://api.partnercenter.microsoft.com/v1/customers/${customerId}/subscriptions`, { headers: { Authorization: `Bearer ${token}` } });"
      },
      "gotchas": ["App-only authentication is not supported for all customer operations; this one requires app+user."],
      "docUrl": "https://learn.microsoft.com/partner-center/developer/get-a-list-of-subscriptions",
      "lastVerified": "2026-06-18"
    }
  ]
}
```

- [ ] **Step 4: Create `data/errors.json`** (real Partner Center REST error codes)

```json
{
  "version": "2026-06",
  "errors": [
    { "httpStatus": 401, "errorCode": "900420", "description": "The audience in the token is invalid and is no longer supported in Partner Center API.", "causes": ["Token requested with the retired graph.windows.net audience"], "remediation": "Request the token with resource https://api.partnercenter.microsoft.com (see the deprecate-azure-active-directory-graph-token guidance).", "docUrl": "https://learn.microsoft.com/partner-center/developer/deprecate-azure-active-directory-graph-token" },
    { "httpStatus": 400, "errorCode": "900154", "description": "The PLA ID (formerly MPN ID) is not linked to an active CSP indirect reseller tenant.", "causes": ["Reseller not enrolled as an indirect reseller"], "remediation": "Have the reseller enroll into the CSP program as an indirect reseller in Partner Center.", "docUrl": "https://learn.microsoft.com/partner-center/developer/error-codes" },
    { "httpStatus": 400, "errorCode": "900419", "description": "This customer tenant has exceeded the limit for the number of subscriptions.", "causes": ["Subscription count over the Entra limit"], "remediation": "Consolidate subscriptions per the Partner Center documentation.", "docUrl": "https://learn.microsoft.com/partner-center/developer/error-codes" },
    { "httpStatus": 403, "errorCode": "900416", "description": "This customer account is locked for transactions.", "causes": ["Account locked"], "remediation": "Contact Partner Center support.", "docUrl": "https://learn.microsoft.com/partner-center/developer/error-codes" }
  ]
}
```

- [ ] **Step 5: Create `data/auth.json`** (real auth patterns and clouds)

```json
{
  "version": "2026-06",
  "clouds": {
    "commercial": { "tokenResource": "https://api.partnercenter.microsoft.com", "authority": "https://login.microsoftonline.com" },
    "china-21vianet": { "tokenResource": "https://partner.partnercenterapi.microsoftonline.cn", "authority": "https://login.partner.microsoftonline.cn" }
  },
  "patterns": {
    "app-only": {
      "steps": [
        "Register a web app in Microsoft Entra ID.",
        "Grant it Partner Center API permissions and admin consent.",
        "Request a token from https://login.microsoftonline.com/{tenantId}/oauth2/token."
      ],
      "tokenRequest": "resource=https://api.partnercenter.microsoft.com&client_id={client-id}&client_secret={secret}&grant_type=client_credentials",
      "supportedNote": "Not all operations support app-only; check each scenario's authType. Native apps support app+user only."
    },
    "app+user": {
      "steps": [
        "Use the secure application model (refresh-token based).",
        "Acquire a user token, then exchange it for a Partner Center token with resource https://api.partnercenter.microsoft.com."
      ],
      "secureAppModel": "Required for app+user; see enable-secure-app-model.",
      "mfa": { "enforcementDate": "2026-04-01", "note": "From 2026-04-01 all App+User usage of Partner Center APIs enforces MFA. From October 2025 the API confirms presence of the MFA claim." }
    }
  },
  "deprecations": [
    { "what": "graph.windows.net audience tokens", "status": "retired 2025-08; Partner Center APIs return 401 / 900420", "fix": "Request tokens with resource https://api.partnercenter.microsoft.com." },
    { "what": "Partner Center .NET SDK 3.4.0", "status": "archived June 2023", "fix": "Use the Partner Center REST APIs directly." }
  ]
}
```

- [ ] **Step 6: Create `data/sdk-map.json`** (archived SDK → REST mappings)

```json
{
  "version": "2026-06",
  "mappings": [
    { "sdkPattern": "Customers.ById({customerId}).Subscriptions.Get()", "restScenarioId": "list-customer-subscriptions", "notes": "GET /v1/customers/{customerId}/subscriptions with an app+user token." },
    { "sdkPattern": "Customers.ById({customerId}).Users.ById({userId}).LicenseUpdates.Create(update)", "restScenarioId": "assign-licenses", "notes": "POST /v1/customers/{customerId}/users/{userId}/licenseupdates with a LicenseUpdate body." },
    { "sdkPattern": "Profiles.MpnProfile.Get()", "restScenarioId": "verify-mpn", "notes": "GET /v1/profiles/mpn (omit mpnId for the signed-in partner)." }
  ]
}
```

- [ ] **Step 7: Create `data/reference.json`**

```json
{
  "baseUrls": {
    "commercial": "https://api.partnercenter.microsoft.com",
    "china-21vianet": "https://partner.partnercenterapi.microsoftonline.cn"
  },
  "headers": [
    { "name": "Authorization", "purpose": "Bearer access token, audience https://api.partnercenter.microsoft.com" },
    { "name": "MS-CorrelationId", "purpose": "GUID to correlate a single request in support cases" },
    { "name": "MS-RequestId", "purpose": "GUID for idempotency of write operations" },
    { "name": "Accept-Language", "purpose": "Locale for localized responses" }
  ],
  "versioning": "Resource paths are prefixed with /v1. The generatetoken API uses /v3.",
  "sandbox": "Use your integration sandbox account and its tokens while developing so you do not incur real charges.",
  "rateLimits": "Honor HTTP 429 responses and the Retry-After header; back off and retry."
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run test/data.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 9: Commit**

```bash
git add data test/data.test.ts
git commit -m "feat: curated Partner Center knowledge pack (scenarios, errors, auth, sdk-map, reference)"
```

---

### Task 4: Live doc fetch utility

**Files:**
- Create: `src/docs/fetch.ts`
- Modify: `src/types.ts` (replace placeholder `DocFetch` with the real type re-export — optional; the structural type already matches)
- Test: `test/fetch.test.ts`

**Interfaces:**
- Produces: `makeDocFetch(opts?: { fetchImpl?: typeof fetch; defaultTimeoutMs?: number }): DocFetch`. The returned `DocFetch(query, { timeoutMs? })` queries the Microsoft Learn search API, returns `{ ok, excerpts: {title,url,text}[], note? }`, and on any network/timeout error resolves `{ ok: false, excerpts: [], note }` — never throws.

- [ ] **Step 1: Write the failing test**

Create `test/fetch.test.ts`:

```ts
import { test, expect } from "vitest";
import { makeDocFetch } from "../src/docs/fetch.js";

test("docFetch returns excerpts from a successful response", async () => {
  const fakeFetch = (async () => ({
    ok: true,
    json: async () => ({ results: [{ title: "Auth", url: "https://learn.microsoft.com/x", excerpt: "use api.partnercenter" }] }),
  })) as unknown as typeof fetch;
  const docFetch = makeDocFetch({ fetchImpl: fakeFetch });
  const r = await docFetch("auth");
  expect(r.ok).toBe(true);
  expect(r.excerpts[0].url).toBe("https://learn.microsoft.com/x");
});

test("docFetch degrades gracefully on a thrown network error", async () => {
  const failing = (async () => { throw new Error("ENOTFOUND"); }) as unknown as typeof fetch;
  const docFetch = makeDocFetch({ fetchImpl: failing });
  const r = await docFetch("auth");
  expect(r.ok).toBe(false);
  expect(r.excerpts).toEqual([]);
  expect(r.note).toMatch(/unavailable/i);
});

test("docFetch degrades gracefully on a non-ok HTTP status", async () => {
  const notOk = (async () => ({ ok: false, status: 503, json: async () => ({}) })) as unknown as typeof fetch;
  const r = await makeDocFetch({ fetchImpl: notOk })("auth");
  expect(r.ok).toBe(false);
  expect(r.note).toMatch(/unavailable/i);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/fetch.test.ts`
Expected: FAIL — `makeDocFetch` not found.

- [ ] **Step 3: Create `src/docs/fetch.ts`**

```ts
import type { DocFetch } from "../types.js";

const ENDPOINT = "https://learn.microsoft.com/api/search";

interface MakeOpts { fetchImpl?: typeof fetch; defaultTimeoutMs?: number }

export function makeDocFetch(opts: MakeOpts = {}): DocFetch {
  const doFetch = opts.fetchImpl ?? fetch;
  const defaultTimeout = opts.defaultTimeoutMs ?? 5000;

  return async (query, callOpts) => {
    const timeoutMs = callOpts?.timeoutMs ?? defaultTimeout;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const url = `${ENDPOINT}?search=${encodeURIComponent(query)}&locale=en-us&scope=partner-center`;
      const res = (await doFetch(url, { signal: controller.signal } as RequestInit)) as Response;
      if (!res.ok) return { ok: false, excerpts: [], note: `Live doc fetch unavailable (HTTP ${res.status}); using curated knowledge only.` };
      const body = (await res.json()) as { results?: { title: string; url: string; excerpt?: string }[] };
      const excerpts = (body.results ?? []).map((r) => ({ title: r.title, url: r.url, text: r.excerpt ?? "" }));
      return { ok: true, excerpts };
    } catch {
      return { ok: false, excerpts: [], note: "Live doc fetch unavailable (network error); using curated knowledge only." };
    } finally {
      clearTimeout(timer);
    }
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/fetch.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/docs/fetch.ts test/fetch.test.ts
git commit -m "feat: bounded, graceful live doc fetch"
```

---

### Task 5: Discovery tools (list, get, search)

**Files:**
- Create: `src/tools/listScenarios.ts`, `src/tools/getScenario.ts`, `src/tools/searchDocs.ts`
- Test: `test/discovery.test.ts`

**Interfaces:**
- Consumes: `Knowledge`, `ToolContext`, `Tool`, result helpers, `DocFetch`.
- Produces: three `Tool` objects named `pc_list_scenarios`, `pc_get_scenario`, `pc_search_docs`.

- [ ] **Step 1: Write the failing test**

Create `test/discovery.test.ts`:

```ts
import { test, expect } from "vitest";
import { loadKnowledge } from "../src/knowledge/load.js";
import { listScenarios } from "../src/tools/listScenarios.js";
import { getScenario } from "../src/tools/getScenario.js";
import { searchDocs } from "../src/tools/searchDocs.js";
import type { ToolContext } from "../src/types.js";

const knowledge = loadKnowledge("data");
const ctx: ToolContext = { knowledge, docFetch: async () => ({ ok: true, excerpts: [{ title: "t", url: "https://learn.microsoft.com/x", text: "e" }] }) };

test("pc_list_scenarios lists all, and filters by area", async () => {
  const all = await listScenarios.run({}, ctx);
  expect((all.data as any[]).length).toBe(knowledge.scenarios.length);
  const subs = await listScenarios.run({ area: "subscriptions" }, ctx);
  expect((subs.data as any[]).every((s) => s.area === "subscriptions")).toBe(true);
});

test("pc_get_scenario returns a full record or notFound with suggestions", async () => {
  const got = await getScenario.run({ id: "verify-mpn" }, ctx);
  expect((got.data as any).path).toContain("/v1/profiles/mpn");
  const miss = await getScenario.run({ id: "nope" }, ctx);
  expect(miss.ok).toBe(false);
  expect(miss.suggestions).toBeTruthy();
});

test("pc_get_scenario enrich attaches live excerpts", async () => {
  const got = await getScenario.run({ id: "verify-mpn", enrich: true }, ctx);
  expect((got.data as any).liveDocs[0].url).toBe("https://learn.microsoft.com/x");
});

test("pc_search_docs returns excerpts", async () => {
  const r = await searchDocs.run({ query: "auth" }, ctx);
  expect((r.data as any).excerpts[0].url).toBe("https://learn.microsoft.com/x");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/discovery.test.ts`
Expected: FAIL — tool modules not found.

- [ ] **Step 3: Create `src/tools/listScenarios.ts`**

```ts
import { z } from "zod";
import type { Tool } from "../types.js";
import type { Knowledge } from "../knowledge/schema.js";
import { ok } from "../util/result.js";

export const listScenarios: Tool = {
  name: "pc_list_scenarios",
  description: "List supported Partner Center REST scenarios, optionally filtered by area.",
  inputShape: { area: z.enum(["customers", "subscriptions", "orders", "licenses", "invoicing", "profiles", "auth"]).optional() },
  run(args, ctx) {
    const k = ctx.knowledge as Knowledge;
    const scenarios = args.area ? k.scenarios.filter((s) => s.area === args.area) : k.scenarios;
    return ok(scenarios.map((s) => ({ id: s.id, title: s.title, area: s.area, method: s.method, path: s.path, authType: s.authType, docUrl: s.docUrl })));
  },
};
```

- [ ] **Step 4: Create `src/tools/getScenario.ts`**

```ts
import { z } from "zod";
import type { Tool } from "../types.js";
import type { Knowledge } from "../knowledge/schema.js";
import { ok, notFound } from "../util/result.js";

export const getScenario: Tool = {
  name: "pc_get_scenario",
  description: "Get the full record for a Partner Center scenario: endpoint, auth, headers, ready REST examples, gotchas. Set enrich to attach live doc excerpts.",
  inputShape: { id: z.string(), enrich: z.boolean().optional() },
  async run(args, ctx) {
    const k = ctx.knowledge as Knowledge;
    const scenario = k.scenarios.find((s) => s.id === args.id);
    if (!scenario) {
      const suggestions = k.scenarios.map((s) => s.id).filter((id) => id.includes(args.id) || args.id.includes(id));
      return notFound(`No scenario with id "${args.id}".`, suggestions.length ? suggestions : k.scenarios.map((s) => s.id));
    }
    if (args.enrich) {
      const live = await ctx.docFetch(`${scenario.title} Partner Center`);
      return ok({ ...scenario, liveDocs: live.excerpts, liveNote: live.note });
    }
    return ok(scenario);
  },
};
```

- [ ] **Step 5: Create `src/tools/searchDocs.ts`**

```ts
import { z } from "zod";
import type { Tool } from "../types.js";
import { ok } from "../util/result.js";

export const searchDocs: Tool = {
  name: "pc_search_docs",
  description: "Search current Microsoft Learn Partner Center developer docs for depth beyond the curated pack.",
  inputShape: { query: z.string(), topK: z.number().int().positive().max(10).optional() },
  async run(args, ctx) {
    const live = await ctx.docFetch(`Partner Center ${args.query}`);
    const excerpts = args.topK ? live.excerpts.slice(0, args.topK) : live.excerpts;
    return ok({ excerpts, note: live.note });
  },
};
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run test/discovery.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add src/tools/listScenarios.ts src/tools/getScenario.ts src/tools/searchDocs.ts test/discovery.test.ts
git commit -m "feat: discovery tools (list, get, search docs)"
```

---

### Task 6: Auth tools (guidance, deprecation linter)

**Files:**
- Create: `src/tools/authGuidance.ts`, `src/tools/checkAuth.ts`
- Test: `test/auth.test.ts`

**Interfaces:**
- Consumes: `Knowledge.auth`, result helpers.
- Produces: tools `pc_auth_guidance` and `pc_check_auth`. `pc_check_auth` returns `{ findings: { pattern, severity, message, fix, docUrl }[], clean: boolean }`.

- [ ] **Step 1: Write the failing test**

Create `test/auth.test.ts`:

```ts
import { test, expect } from "vitest";
import { loadKnowledge } from "../src/knowledge/load.js";
import { authGuidance } from "../src/tools/authGuidance.js";
import { checkAuth } from "../src/tools/checkAuth.js";
import type { ToolContext } from "../src/types.js";

const ctx: ToolContext = { knowledge: loadKnowledge("data"), docFetch: async () => ({ ok: true, excerpts: [] }) };

test("pc_auth_guidance returns the pattern with the current resource and MFA date", async () => {
  const r = await authGuidance.run({ authType: "app+user" }, ctx);
  const data = r.data as any;
  expect(data.cloud.tokenResource).toBe("https://api.partnercenter.microsoft.com");
  expect(data.pattern.mfa.enforcementDate).toBe("2026-04-01");
});

test("pc_check_auth flags the retired graph.windows.net audience", async () => {
  const code = "resource=https://graph.windows.net&grant_type=client_credentials";
  const r = await checkAuth.run({ code }, ctx);
  const data = r.data as any;
  expect(data.clean).toBe(false);
  expect(data.findings.some((f: any) => /graph\.windows\.net/.test(f.message))).toBe(true);
});

test("pc_check_auth reports clean for a correct snippet", async () => {
  const code = "resource=https://api.partnercenter.microsoft.com&grant_type=client_credentials";
  const r = await checkAuth.run({ code }, ctx);
  expect((r.data as any).clean).toBe(true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/auth.test.ts`
Expected: FAIL — tool modules not found.

- [ ] **Step 3: Create `src/tools/authGuidance.ts`**

```ts
import { z } from "zod";
import type { Tool } from "../types.js";
import type { Knowledge } from "../knowledge/schema.js";
import { ok, notFound } from "../util/result.js";

export const authGuidance: Tool = {
  name: "pc_auth_guidance",
  description: "Current Partner Center authentication guidance for app-only or app+user, per national cloud, with deprecation and MFA notes.",
  inputShape: {
    authType: z.enum(["app-only", "app+user"]),
    cloud: z.enum(["commercial", "china-21vianet", "us-gov"]).optional(),
  },
  run(args, ctx) {
    const auth = (ctx.knowledge as Knowledge).auth;
    const cloudKey = args.cloud ?? "commercial";
    const cloud = auth.clouds[cloudKey];
    if (!cloud) return notFound(`No auth data for cloud "${cloudKey}".`, Object.keys(auth.clouds));
    return ok({ cloud, pattern: auth.patterns[args.authType], deprecations: auth.deprecations });
  },
};
```

- [ ] **Step 4: Create `src/tools/checkAuth.ts`**

```ts
import { z } from "zod";
import type { Tool } from "../types.js";
import { ok } from "../util/result.js";

interface Rule { pattern: RegExp; severity: "error" | "warning"; message: string; fix: string; docUrl: string }

const RULES: Rule[] = [
  {
    pattern: /graph\.windows\.net/i,
    severity: "error",
    message: "Uses the retired graph.windows.net audience; Partner Center returns 401 / 900420.",
    fix: "Request the token with resource https://api.partnercenter.microsoft.com.",
    docUrl: "https://learn.microsoft.com/partner-center/developer/deprecate-azure-active-directory-graph-token",
  },
  {
    pattern: /AuthenticationContext|ActiveDirectory\.Library|\bADAL\b/i,
    severity: "warning",
    message: "Appears to use ADAL (Azure AD Authentication Library), which is deprecated.",
    fix: "Use MSAL with the secure application model.",
    docUrl: "https://learn.microsoft.com/partner-center/developer/enable-secure-app-model",
  },
  {
    pattern: /IAggregatePartner|PartnerService\.Instance|partner-center-sdk/i,
    severity: "warning",
    message: "References the archived Partner Center .NET SDK (3.4.0, archived June 2023).",
    fix: "Call the Partner Center REST APIs directly. Use pc_migrate_from_sdk to translate.",
    docUrl: "https://learn.microsoft.com/partner-center/developer/get-started",
  },
];

export const checkAuth: Tool = {
  name: "pc_check_auth",
  description: "Lint a Partner Center auth or client snippet for retired/deprecated patterns (graph.windows.net audience, ADAL, archived SDK) and return fixes.",
  inputShape: { code: z.string() },
  run(args) {
    const findings = RULES.filter((r) => r.pattern.test(args.code)).map((r) => ({
      severity: r.severity, message: r.message, fix: r.fix, docUrl: r.docUrl,
    }));
    return ok({ findings, clean: findings.length === 0 });
  },
};
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run test/auth.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/tools/authGuidance.ts src/tools/checkAuth.ts test/auth.test.ts
git commit -m "feat: auth guidance and deprecation linter tools"
```

---

### Task 7: Codegen and migration tools

**Files:**
- Create: `src/tools/generateCall.ts`, `src/tools/migrateFromSdk.ts`
- Test: `test/codegen.test.ts`

**Interfaces:**
- Consumes: `Knowledge.scenarios`, `Knowledge.sdkMap`, result helpers.
- Produces: tools `pc_generate_call` and `pc_migrate_from_sdk`. `pc_generate_call` returns `{ language, code, authType, docUrl }`. `pc_migrate_from_sdk` returns `{ matches: { sdkPattern, scenario, notes }[], unmatched: boolean }`.

- [ ] **Step 1: Write the failing test**

Create `test/codegen.test.ts`:

```ts
import { test, expect } from "vitest";
import { loadKnowledge } from "../src/knowledge/load.js";
import { generateCall } from "../src/tools/generateCall.js";
import { migrateFromSdk } from "../src/tools/migrateFromSdk.js";
import type { ToolContext } from "../src/types.js";

const ctx: ToolContext = { knowledge: loadKnowledge("data"), docFetch: async () => ({ ok: true, excerpts: [] }) };

test("pc_generate_call returns the curated example for the language", async () => {
  const r = await generateCall.run({ id: "verify-mpn", language: "typescript" }, ctx);
  const data = r.data as any;
  expect(data.code).toContain("api.partnercenter.microsoft.com");
  expect(data.code).not.toMatch(/graph\.windows\.net/);
});

test("pc_generate_call notFounds an unknown scenario", async () => {
  const r = await generateCall.run({ id: "nope", language: "curl" }, ctx);
  expect(r.ok).toBe(false);
});

test("pc_migrate_from_sdk maps a known SDK pattern to a REST scenario", async () => {
  const r = await migrateFromSdk.run({ code: "partner.Customers.ById(id).Subscriptions.Get()" }, ctx);
  const data = r.data as any;
  expect(data.unmatched).toBe(false);
  expect(data.matches[0].scenario.id).toBe("list-customer-subscriptions");
});

test("pc_migrate_from_sdk reports unmatched for unrecognized code", async () => {
  const r = await migrateFromSdk.run({ code: "var x = 1;" }, ctx);
  expect((r.data as any).unmatched).toBe(true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/codegen.test.ts`
Expected: FAIL — tool modules not found.

- [ ] **Step 3: Create `src/tools/generateCall.ts`**

```ts
import { z } from "zod";
import type { Tool } from "../types.js";
import type { Knowledge } from "../knowledge/schema.js";
import { ok, notFound } from "../util/result.js";

export const generateCall: Tool = {
  name: "pc_generate_call",
  description: "Generate a current Partner Center REST call for a scenario in the chosen language. Never emits the archived .NET SDK.",
  inputShape: {
    id: z.string(),
    language: z.enum(["curl", "csharp", "typescript", "powershell"]),
  },
  run(args, ctx) {
    const k = ctx.knowledge as Knowledge;
    const scenario = k.scenarios.find((s) => s.id === args.id);
    if (!scenario) return notFound(`No scenario with id "${args.id}".`, k.scenarios.map((s) => s.id));
    const lang = args.language;
    // powershell is derived from curl when no dedicated example exists.
    const code = lang === "powershell"
      ? `# PowerShell (Invoke-RestMethod)\nInvoke-RestMethod -Method ${scenario.method} -Uri "https://api.partnercenter.microsoft.com${scenario.path}" -Headers @{ Authorization = "Bearer $token" }`
      : scenario.examples[lang];
    return ok({ language: lang, code, authType: scenario.authType, docUrl: scenario.docUrl });
  },
};
```

- [ ] **Step 4: Create `src/tools/migrateFromSdk.ts`**

```ts
import { z } from "zod";
import type { Tool } from "../types.js";
import type { Knowledge } from "../knowledge/schema.js";
import { ok } from "../util/result.js";

// Turn a curated sdkPattern like "Customers.ById({id}).Subscriptions.Get()" into a
// loose matcher: drop {placeholders} and match the method-chain tail, case-insensitively.
function matcher(sdkPattern: string): RegExp {
  const core = sdkPattern.replace(/\{[^}]+\}/g, "[^)]*").replace(/[.*+?^$()|[\]\\]/g, (c) => "\\" + c);
  return new RegExp(core.replace(/\\\(\\\[\^\\\)\\\]\\\*\\\)/g, "\\([^)]*\\)"), "i");
}

export const migrateFromSdk: Tool = {
  name: "pc_migrate_from_sdk",
  description: "Translate archived Partner Center .NET SDK code into the equivalent current REST scenario(s).",
  inputShape: { code: z.string() },
  run(args, ctx) {
    const k = ctx.knowledge as Knowledge;
    const matches = k.sdkMap
      .filter((m) => {
        const tail = m.sdkPattern.split(".").slice(-2).join(".").replace(/\{[^}]+\}/g, "");
        const needle = tail.replace(/\(\)$/, "").replace(/[()]/g, "");
        return new RegExp(needle, "i").test(args.code);
      })
      .map((m) => ({ sdkPattern: m.sdkPattern, notes: m.notes, scenario: k.scenarios.find((s) => s.id === m.restScenarioId) }))
      .filter((m) => m.scenario);
    return ok({ matches, unmatched: matches.length === 0 });
  },
};
```

Note: the `matcher` helper above is intentionally unused in the final `run` (the inline tail match is simpler and sufficient for the seed patterns). Remove `matcher` if your linter flags it — it is shown only to document the matching intent. Prefer the inline `tail`/`needle` approach in `run`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run test/codegen.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/tools/generateCall.ts src/tools/migrateFromSdk.ts test/codegen.test.ts
git commit -m "feat: code generation and SDK-to-REST migration tools"
```

---

### Task 8: Error and reference tools

**Files:**
- Create: `src/tools/lookupError.ts`, `src/tools/diagnose.ts`, `src/tools/getReference.ts`
- Test: `test/errorref.test.ts`

**Interfaces:**
- Consumes: `Knowledge.errors`, `Knowledge.reference`, `Knowledge.auth`, result helpers.
- Produces: tools `pc_lookup_error`, `pc_diagnose`, `pc_get_reference`.

- [ ] **Step 1: Write the failing test**

Create `test/errorref.test.ts`:

```ts
import { test, expect } from "vitest";
import { loadKnowledge } from "../src/knowledge/load.js";
import { lookupError } from "../src/tools/lookupError.js";
import { diagnose } from "../src/tools/diagnose.js";
import { getReference } from "../src/tools/getReference.js";
import type { ToolContext } from "../src/types.js";

const ctx: ToolContext = { knowledge: loadKnowledge("data"), docFetch: async () => ({ ok: true, excerpts: [] }) };

test("pc_lookup_error finds by error code and by http status", async () => {
  const byCode = await lookupError.run({ code: "900420" }, ctx);
  expect((byCode.data as any).remediation).toContain("api.partnercenter.microsoft.com");
  const byStatus = await lookupError.run({ httpStatus: 403 }, ctx);
  expect((byStatus.data as any[]).some((e: any) => e.httpStatus === 403)).toBe(true);
});

test("pc_lookup_error notFounds an unknown code", async () => {
  const r = await lookupError.run({ code: "111111" }, ctx);
  expect(r.ok).toBe(false);
});

test("pc_diagnose surfaces the retired-token error for a 401 symptom", async () => {
  const r = await diagnose.run({ symptom: "I get 401 900420 even though my token is new" }, ctx);
  expect((r.data as any).likely.some((e: any) => e.errorCode === "900420")).toBe(true);
});

test("pc_get_reference returns base urls", async () => {
  const r = await getReference.run({ topic: "base-urls" }, ctx);
  expect((r.data as any).commercial).toContain("api.partnercenter.microsoft.com");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/errorref.test.ts`
Expected: FAIL — tool modules not found.

- [ ] **Step 3: Create `src/tools/lookupError.ts`**

```ts
import { z } from "zod";
import type { Tool } from "../types.js";
import type { Knowledge } from "../knowledge/schema.js";
import { ok, notFound, toolError } from "../util/result.js";

export const lookupError: Tool = {
  name: "pc_lookup_error",
  description: "Look up a Partner Center REST error by error code or HTTP status: meaning, causes, remediation.",
  inputShape: { code: z.string().optional(), httpStatus: z.number().int().optional() },
  run(args, ctx) {
    const errors = (ctx.knowledge as Knowledge).errors;
    if (args.code) {
      const hit = errors.find((e) => e.errorCode === args.code);
      return hit ? ok(hit) : notFound(`No error with code "${args.code}".`, errors.map((e) => e.errorCode));
    }
    if (args.httpStatus !== undefined) {
      const hits = errors.filter((e) => e.httpStatus === args.httpStatus);
      return hits.length ? ok(hits) : notFound(`No errors for HTTP ${args.httpStatus}.`, [...new Set(errors.map((e) => String(e.httpStatus)))]);
    }
    return toolError("Provide either code or httpStatus.");
  },
};
```

- [ ] **Step 4: Create `src/tools/diagnose.ts`**

```ts
import { z } from "zod";
import type { Tool } from "../types.js";
import type { Knowledge } from "../knowledge/schema.js";
import { ok } from "../util/result.js";

export const diagnose: Tool = {
  name: "pc_diagnose",
  description: "Diagnose a Partner Center symptom in natural language: surface likely error(s) and a fix path.",
  inputShape: { symptom: z.string() },
  run(args, ctx) {
    const k = ctx.knowledge as Knowledge;
    const text = args.symptom.toLowerCase();
    const likely = k.errors.filter((e) =>
      text.includes(e.errorCode) || text.includes(String(e.httpStatus)) ||
      e.causes.some((c) => c.toLowerCase().split(" ").some((w) => w.length > 4 && text.includes(w))),
    );
    const nextSteps = [
      "Confirm your token audience is https://api.partnercenter.microsoft.com (pc_check_auth).",
      "Check the operation's required authType with pc_get_scenario.",
      "If still stuck, search current docs with pc_search_docs.",
    ];
    return ok({ likely, nextSteps });
  },
};
```

- [ ] **Step 5: Create `src/tools/getReference.ts`**

```ts
import { z } from "zod";
import type { Tool } from "../types.js";
import type { Knowledge } from "../knowledge/schema.js";
import { ok } from "../util/result.js";

export const getReference: Tool = {
  name: "pc_get_reference",
  description: "Partner Center REST reference: base URLs, required headers, versioning, sandbox, rate limits.",
  inputShape: { topic: z.enum(["base-urls", "headers", "versioning", "sandbox", "rate-limits"]) },
  run(args, ctx) {
    const ref = (ctx.knowledge as Knowledge).reference;
    switch (args.topic) {
      case "base-urls": return ok(ref.baseUrls);
      case "headers": return ok(ref.headers);
      case "versioning": return ok({ versioning: ref.versioning });
      case "sandbox": return ok({ sandbox: ref.sandbox });
      case "rate-limits": return ok({ rateLimits: ref.rateLimits });
    }
  },
};
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run test/errorref.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add src/tools/lookupError.ts src/tools/diagnose.ts src/tools/getReference.ts test/errorref.test.ts
git commit -m "feat: error lookup, diagnose, and reference tools"
```

---

### Task 9: Wire all tools, MCP smoke, build, README

**Files:**
- Modify: `src/tools/index.ts`
- Create: `README.md`
- Test: `test/registry.test.ts`

**Interfaces:**
- Consumes: all ten tool modules.
- Produces: `allTools` containing all ten; a green build; host setup docs.

- [ ] **Step 1: Write the failing test**

Create `test/registry.test.ts`:

```ts
import { test, expect } from "vitest";
import { allTools } from "../src/tools/index.js";

test("allTools exposes the ten Partner Center tools with unique names", () => {
  const names = allTools.map((t) => t.name).sort();
  expect(names).toEqual([
    "pc_auth_guidance", "pc_check_auth", "pc_diagnose", "pc_generate_call",
    "pc_get_reference", "pc_get_scenario", "pc_list_scenarios", "pc_lookup_error",
    "pc_migrate_from_sdk", "pc_search_docs",
  ]);
  expect(new Set(names).size).toBe(names.length);
});

test("every tool has a description and an input shape", () => {
  for (const t of allTools) {
    expect(t.description.length).toBeGreaterThan(0);
    expect(typeof t.inputShape).toBe("object");
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/registry.test.ts`
Expected: FAIL — `allTools` is still empty.

- [ ] **Step 3: Fill `src/tools/index.ts`**

```ts
import type { Tool } from "../types.js";
import { listScenarios } from "./listScenarios.js";
import { getScenario } from "./getScenario.js";
import { searchDocs } from "./searchDocs.js";
import { authGuidance } from "./authGuidance.js";
import { checkAuth } from "./checkAuth.js";
import { generateCall } from "./generateCall.js";
import { migrateFromSdk } from "./migrateFromSdk.js";
import { lookupError } from "./lookupError.js";
import { diagnose } from "./diagnose.js";
import { getReference } from "./getReference.js";

export const allTools: Tool[] = [
  listScenarios, getScenario, searchDocs,
  authGuidance, checkAuth,
  generateCall, migrateFromSdk,
  lookupError, diagnose, getReference,
];
```

- [ ] **Step 4: Run the registry test and full suite**

Run: `npx vitest run`
Expected: all tests pass (registry + every prior task's tests).

- [ ] **Step 5: Verify the build compiles**

Run: `npm run build`
Expected: `tsc` exits 0; `dist/index.js` exists. (Fix any type errors surfaced here; the test suite does not run `tsc`.)

- [ ] **Step 6: Smoke-test the built server starts**

Run: `node -e "import('./dist/server.js').then(async m => { const { loadKnowledge } = await import('./dist/knowledge/load.js'); const { allTools } = await import('./dist/tools/index.js'); const { makeDocFetch } = await import('./dist/docs/fetch.js'); const s = m.createServer(allTools, { knowledge: loadKnowledge('data'), docFetch: makeDocFetch() }); console.log('server ok', !!s); })"`
Expected: prints `server ok true`.

- [ ] **Step 7: Create `README.md`**

```markdown
# partner-center-mcp

An MCP server that helps you build against the **Partner Center REST API**: scenario
discovery, ready REST examples, current authentication guidance, an auth deprecation
linter, archived-.NET-SDK → REST migration, error decoding, and reference. Grounded in a
curated knowledge pack plus live Microsoft Learn doc fetch. It holds no credentials and
makes no live Partner Center calls.

## Why

The Partner Center .NET SDK (3.4.0) was archived in June 2023; Microsoft directs partners
to the REST APIs. Deprecated auth (the retired `graph.windows.net` audience) still causes
401/900420 failures. This server steers you to the current REST + auth patterns.

## Run

```bash
npx partner-center-mcp
```

## Add to a host

**VS Code (`.vscode/mcp.json`):**
```json
{ "servers": { "partner-center": { "command": "npx", "args": ["-y", "partner-center-mcp"] } } }
```

**Visual Studio (`.mcp.json`):**
```json
{ "servers": { "partner-center": { "command": "npx", "args": ["-y", "partner-center-mcp"] } } }
```

**Claude Code:**
```bash
claude mcp add partner-center -- npx -y partner-center-mcp
```

Tip: also add the **Microsoft Learn MCP server** (`https://learn.microsoft.com/api/mcp`)
alongside for broad documentation search.

## Tools

`pc_list_scenarios`, `pc_get_scenario`, `pc_search_docs`, `pc_auth_guidance`,
`pc_check_auth`, `pc_generate_call`, `pc_migrate_from_sdk`, `pc_lookup_error`,
`pc_diagnose`, `pc_get_reference`.

## Develop

```bash
npm install
npm test
npm run build
```

The knowledge pack lives in `data/` (date-versioned; each record has `docUrl` and
`lastVerified`).
```

- [ ] **Step 8: Commit**

```bash
git add src/tools/index.ts README.md test/registry.test.ts
git commit -m "feat: register all ten tools, add README and MCP smoke"
```

---

## Self-Review

**Spec coverage:**
- Hybrid grounding (curated pack + live fetch) → Tasks 2-4. ✓
- Ten tools across five categories → Tasks 5-8 (3+2+2+3). ✓
- Knowledge pack model (5 files, docUrl + lastVerified) → Tasks 2-3. ✓
- Project structure → Task 1 + per-tool tasks. ✓
- Error handling (startup validation, per-tool input, not-found suggestions, graceful live-fetch) → Task 2 (loader throws), Task 4 (graceful fetch), Tasks 5-8 (notFound suggestions). ✓
- Testing (unit per tool, knowledge validation, freshness, mocked fetch, MCP smoke) → Tasks 2,3,4-8,9. ✓
- Distribution (npx, host config, Learn MCP note) → Task 9 README. ✓
- No archived SDK in generated code → `generateCall` emits curated REST examples; `data` examples use `api.partnercenter.microsoft.com`; `codegen.test.ts` asserts no `graph.windows.net`. ✓

**Placeholder scan:** No TBD/TODO. The `matcher` helper in Task 7 is explicitly documented as illustrative and to be omitted; the working `run` uses the inline tail match. `index.ts` references Tasks 2/4 modules but is not under test until they exist (called out in Task 1).

**Type consistency:** `Tool`/`ToolContext`/`ToolResult` defined in Task 1 and used unchanged throughout. `Knowledge` shape defined in Task 2 (`scenarios`, `errors`, `auth`, `sdkMap`, `reference`) and consumed with those exact property names in every tool. `DocFetch` signature (returns `{ ok, excerpts, note? }`) matches between Task 1 (type), Task 4 (impl), and Task 5/get-scenario+search consumers. Result helpers `ok`/`notFound`/`toolError` signatures consistent across tasks. Tool names match between each tool module and the Task 9 registry assertion.
