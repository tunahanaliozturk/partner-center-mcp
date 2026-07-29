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
npm run check-pack # offline: verify scenarios against the committed doc snapshot
```

### Verifying a scenario against the docs

`npm run check-pack` compares every scenario's `method` and `path` against the snapshot in
`verification/doc-facts.json` and fails the build on a mismatch. It's offline and runs on every PR,
so it catches a wrong path in seconds instead of waiting for the weekly job. If you add or change a
scenario whose `docUrl` is not yet snapshotted, run `npm run check-docs:update` to fetch that page
and record it, and commit the snapshot change alongside your scenario change. Never edit
`verification/doc-facts.json` by hand — it is generated from what Microsoft Learn actually says, and
a hand-edit would assert something the docs don't.

`npm run check-docs` (no `:update`) does the same networked fetch but only reports drift against the
existing snapshot; it's what the weekly CI job runs. You normally don't need it for a single-scenario
change — `check-docs:update` is the one that also writes the snapshot.

### The `api` field

Most scenarios target Partner Center and can leave `api` unset. If a scenario's `docUrl` is a
Microsoft Graph page or a pricing/referrals page (host `api.partner.microsoft.com`), set `api` to
`"graph"` or `"pricing-and-referrals"` and write `path` **relative to that API's own base** — the
same way its docs state the route (Graph docs omit the host and the `/v1.0` prefix; Partner Center
docs omit the host entirely). `src/knowledge/apis.ts` resolves the actual base URL from `api` at
request-build time, so `pc_build_request` and `pc_generate_call` still emit the correct absolute URL.

## Add or update a scenario

1. Add an entry to [`data/scenarios.json`](data/scenarios.json). Fields are validated by
   [`src/knowledge/schema.ts`](src/knowledge/schema.ts) at load time, so a malformed record fails fast.
2. Verify the method, path, headers, request/response shapes against the actual Microsoft Learn
   page — open the page's **REST request** section and copy the real values. Set `api` if the page
   is not a Partner Center page (see above).
3. Set `docUrl` to the exact page you verified and `lastVerified` to today (`YYYY-MM-DD`).
4. For write scenarios, fill `requestFields` with the minimum required body fields.
5. If it maps from an archived .NET SDK call, add a row to [`data/sdk-map.json`](data/sdk-map.json)
   (use a single clean `Foo.Bar().Baz()` chain — no `/` or `...`).
6. Run `npm test` and `npm run check-pack` — both must pass. If your `docUrl` is new, run
   `npm run check-docs:update` first so the snapshot has a record to check against.

The data integrity tests enforce: unique ids, every `path` is relative (never an absolute URL — use
`api` for a non-Partner-Center host instead), each `curl` example targets the host implied by its
`api` field and its own path, no `graph.windows.net` leakage, every `sdkMap` reference resolves, and
every error has remediation.

## Add an error code

Add to [`data/errors.json`](data/errors.json) with `httpStatus`, `errorCode`, `description`,
at least one `cause`, a concrete `remediation`, and a `docUrl`.

## Pull requests

- Keep changes focused and described.
- Make sure `npm test` and `npm run check-pack` pass — CI runs both on every PR.
- New tools go under `src/tools/`, are registered in `src/tools/index.ts`, and get an eval case
  (`npm run eval` fails if any tool lacks one).
