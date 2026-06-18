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
