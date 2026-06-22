# partner-center-mcp (.NET)

A C# port of [partner-center-mcp](../README.md) for the .NET ecosystem — same tools and the
**same knowledge pack** (the JSON files under [`../data`](../data) are embedded at build time, so
there is one source of truth shared with the Node version).

Unofficial, community project — not affiliated with Microsoft.

## Run from source

```bash
cd dotnet/PartnerCenterMcp
dotnet run
```

Speaks MCP over stdio. Add to an MCP host (e.g. VS Code `.vscode/mcp.json`):

```json
{ "servers": { "partner-center": { "command": "dotnet", "args": ["run", "--project", "dotnet/PartnerCenterMcp"] } } }
```

## Install via NuGet (`dnx`)

Once published to NuGet, .NET users (and Visual Studio's NuGet MCP browser) can run it with `dnx`:

```json
{ "servers": { "partner-center": { "type": "stdio", "command": "dnx", "args": ["tunahanaliozturk.PartnerCenterMcp", "--yes"] } } }
```

## Package

```bash
dotnet pack -c Release        # -> bin/Release/tunahanaliozturk.PartnerCenterMcp.<ver>.nupkg
dotnet nuget push bin/Release/*.nupkg --source https://api.nuget.org/v3/index.json --api-key <KEY>
```

`PackageType=McpServer` + `.mcp/server.json` make NuGet.org list it as an MCP server.

## Tools

All 20 tools mirror the Node server: `pc_list_scenarios`, `pc_get_scenario`, `pc_generate_call`,
`pc_build_request`, `pc_validate_request`, `pc_migrate_from_sdk`, `pc_auth_guidance`,
`pc_check_auth`, `pc_lookup_error`, `pc_decode_error`, `pc_diagnose`, `pc_get_reference`,
`pc_get_enums`, `pc_whats_new`, `pc_get_resource`, `pc_search_docs`, `pc_plan_purchase`,
`pc_plan_transfer`, `pc_plan_gdap_onboarding`, `pc_plan_reconciliation`.

Target framework: net10.0 (required by `dnx`). MCP SDK: `ModelContextProtocol`.
