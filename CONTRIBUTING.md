# Contributing

Thanks for helping improve **partner-center-mcp** — an unofficial, community MCP server for the
Partner Center REST API. The most valuable contributions are **new scenarios** and **keeping the
knowledge pack accurate against current Microsoft docs**.

## Ground rules

- Everything must be **grounded in official Microsoft Learn docs**. Every scenario/error record
  carries a `docUrl` and (for scenarios) a `lastVerified` date.
- This project holds **no credentials** and makes **no live Partner Center calls**. Keep it that way.
- Keep the **unofficial** framing — don't imply Microsoft affiliation or endorsement.

## Develop

```bash
npm install
npm run build
npm test          # vitest: unit + data-integrity tests
npm run check-docs # verify every docUrl resolves and nothing is stale
```

## Add or update a scenario

1. Add an entry to [`data/scenarios.json`](data/scenarios.json). Fields are validated by
   [`src/knowledge/schema.ts`](src/knowledge/schema.ts) at load time, so a malformed record fails fast.
2. Verify the method, path, headers, request/response shapes against the actual Microsoft Learn
   page — open the page's **REST request** section and copy the real values.
3. Set `docUrl` to the exact page you verified and `lastVerified` to today (`YYYY-MM-DD`).
4. For write scenarios, fill `requestFields` with the minimum required body fields.
5. If it maps from an archived .NET SDK call, add a row to [`data/sdk-map.json`](data/sdk-map.json)
   (use a single clean `Foo.Bar().Baz()` chain — no `/` or `...`).
6. Run `npm test` and `npm run check-docs` — both must pass.

The data integrity tests enforce: unique ids, paths under `/v1` (or an explicit Graph URL),
each `curl` example targets its own host and path, no `graph.windows.net` leakage, every
`sdkMap` reference resolves, and every error has remediation.

## Add an error code

Add to [`data/errors.json`](data/errors.json) with `httpStatus`, `errorCode`, `description`,
at least one `cause`, a concrete `remediation`, and a `docUrl`.

## Pull requests

- Keep changes focused and described.
- Make sure `npm test` and `npm run check-docs` pass.
- New tools go under `src/tools/`, are registered in `src/tools/index.js`, and get a test.
