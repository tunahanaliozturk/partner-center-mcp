# partner-center-mcp

An MCP server that helps you build against the **Partner Center REST API**: scenario
discovery, ready-to-run REST examples, current authentication guidance, an auth deprecation
linter, archived-.NET-SDK → REST migration, error decoding, and reference. Grounded in a
curated, date-versioned knowledge pack plus live Microsoft Learn doc fetch. It holds **no
credentials** and makes **no live Partner Center calls** — it is a knowledge & codegen assistant.

## Why

The Partner Center .NET SDK (3.4.0) was archived in June 2023; Microsoft directs partners to
the REST APIs. Deprecated auth (the retired `graph.windows.net` audience) still causes
401 / `900420` failures, and from **2026-04-01** App+User API usage enforces MFA. This server
steers you to the current REST + auth patterns and decodes the errors you hit along the way.

## Run

```bash
npx partner-center-mcp
```

No configuration, API keys, or network access to Partner Center required.

## Add to your MCP host

The server speaks MCP over **stdio**, so any MCP-capable host works — there's nothing
host-specific to install. Use whichever config your host expects:

**VS Code** (`.vscode/mcp.json`) and **Visual Studio** (`.mcp.json`):

```json
{ "servers": { "partner-center": { "command": "npx", "args": ["-y", "partner-center-mcp"] } } }
```

**GitHub Copilot** — Copilot reads the same `.vscode/mcp.json` (VS Code) / `.mcp.json` (Visual
Studio) shown above; no extra config needed.

**Cursor** (`.cursor/mcp.json`) and **Windsurf** (`~/.codeium/windsurf/mcp_config.json`):

```json
{ "mcpServers": { "partner-center": { "command": "npx", "args": ["-y", "partner-center-mcp"] } } }
```

**Claude Code:**

```bash
claude mcp add partner-center -- npx -y partner-center-mcp
```

**Claude Desktop** (`claude_desktop_config.json`), **Cline**, and **Zed** use the same
`mcpServers` shape as Cursor above.

> Tip: also add the **Microsoft Learn MCP server** (`https://learn.microsoft.com/api/mcp`)
> alongside this one for broad documentation search.

## Tools

| Tool | Purpose |
| --- | --- |
| `pc_list_scenarios` | List supported REST scenarios, optionally filtered by `area`. |
| `pc_get_scenario` | Full detail for one scenario: method, path, headers, examples, gotchas. |
| `pc_generate_call` | Emit a current REST call (`curl`/`csharp`/`typescript`/`powershell`). Never the archived SDK. |
| `pc_migrate_from_sdk` | Translate archived .NET SDK code into the equivalent REST scenario(s). |
| `pc_auth_guidance` | Current auth guidance for app-only / app+user, per national cloud, with GDAP + MFA notes. |
| `pc_check_auth` | Lint an auth/client snippet for retired patterns (graph.windows.net, ADAL, archived SDK, AzureAD PS). |
| `pc_lookup_error` | Decode a Partner Center error code with causes and remediation. |
| `pc_diagnose` | Map a symptom to likely causes, fixes, and relevant scenarios. |
| `pc_search_docs` | Search the curated pack and fetch live Microsoft Learn docs. |
| `pc_get_reference` | Base URLs, required headers, versioning, sandbox, and rate-limit guidance. |

## Coverage

Scenarios span **customers**, **subscriptions** (incl. New Commerce migration), **orders &
carts**, **catalog/products**, **licenses**, **invoicing/billing**, **utilities** (address &
domain validation), **audit**, **support**, **security/MFA**, **analytics**, and **profiles** —
each with a verified `docUrl` and `lastVerified` date. National clouds covered: commercial,
21Vianet (China), and US Gov.

## Develop

```bash
npm install
npm test
npm run build
```

The knowledge pack lives in `data/` (date-versioned; each record carries a `docUrl` and
`lastVerified`). Schemas in [`src/knowledge/schema.ts`](src/knowledge/schema.ts) validate every
file at load time, so malformed or drifted data fails fast.
