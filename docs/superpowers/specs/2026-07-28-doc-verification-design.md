# Deterministic Doc Verification — Design

Date: 2026-07-28
Status: Approved
Scope: sub-project A of four (A: accuracy & automation, B: coverage depth, C: new capabilities,
D: adoption & UX). A ships first because it lowers the per-scenario maintenance cost that B, C, and
D all pay.

## Problem

The knowledge pack holds 96 scenarios across 95 unique `docUrl`s, each hand-authored and
hand-verified against Microsoft Learn. Three gaps make that expensive to keep honest.

**Drift detection guesses.** `scripts/check-docs.mjs` hashes the first 4000 characters of each
page's visible text and flags any change. It cannot say *what* changed, and it cannot say whether
the change touches anything the pack depends on. A Learn template change already produced 81
simultaneous false positives (issue #1); the fix — anchoring the hash at the first `<h1>` — reduced
the blast radius but left the signal fundamentally indirect. A typo correction in a page's prose is
indistinguishable from a changed request path.

**Nothing verifies the fields.** A scenario's `method`, `path`, and `headers` are never compared
against the documentation they claim to come from. If Microsoft changes an endpoint's URI, the pack
keeps serving the old one and every check stays green, because the page-level hash only fires if
that same page's prose also changed enough — and even then it reports "this page changed", not
"this path is wrong".

**Coverage is unmeasured.** The Learn TOC lists 328 pages under `partner-center/developer/`. 81 of
them are referenced by a scenario. Nobody knows how many of the remaining 247 are endpoint pages
that belong in the pack versus conceptual pages that do not, because the question has never been
asked mechanically.

Separately, `scripts/eval.mjs` runs 18 golden cases across 22 tools. Several tools have no case at
all, and every assertion is a substring match against the serialized JSON, so a case can pass on an
incidental match somewhere else in the payload.

## Goals

1. Replace the inferred drift signal with a direct one, and make its severity reflect whether the
   pack is actually affected.
2. Verify the fields the pack asserts — method, path, headers — against the documentation.
3. Produce a mechanical, prioritized list of documented endpoints the pack does not cover.
4. Guarantee every tool has an eval case, and make assertions precise enough to mean something.
5. Do all of the above deterministically, with no LLM in the loop.

## Non-goals

- **No LLM anywhere.** Not for extraction, not for drafting, not for adjudicating drift. This is a
  standing constraint on sub-project A, decided explicitly.
- **No auto-editing of `data/*.json`.** Checks report; humans write the pack.
- **No new scenarios.** A only reports the gaps; filling them is sub-project B.
- **No live Partner Center calls and no credentials.** Unchanged — the server's defining property.
- **No verification of prose fields.** `examples`, `gotchas`, `requestShape`/`responseShape`
  descriptions are not machine-comparable; forcing them into a deterministic check would manufacture
  false positives, which is the failure mode this design exists to eliminate.

## Feasibility (verified live, 2026-07-28)

Every pillar was probed against the real sources before this design was written.

| Claim | Evidence |
| --- | --- |
| Learn pages expose their source commit | `<meta name="gitcommit">` carries a blob URL pinned to a 40-hex SHA — `MicrosoftDocs/partner-center-pr/blob/229a898e…/partner-center/developer/create-a-customer.md`, `microsoftgraph/microsoft-graph-docs/blob/8b9f0fe0…/api-reference/v1.0/api/user-post-users.md`. Exactly one occurrence per page on both doc families. (`original_content_git_url` carries the same path pinned to `live`, so it has no SHA — the commit signal comes from `gitcommit`.) |
| Pages carry stable identity and timestamps | `<meta name="document_id">`, `<meta name="updated_at">`, `<meta name="ms.date">` present on both families. |
| Request facts are extractable | Under the `Request syntax` heading, a table yields `["Method","Request URI"]` / `["POST","{baseURL} /v1/customers HTTP/1.1"]`. Body fields appear as `Name \| Type \| Description` tables. |
| A machine-readable TOC exists | `https://learn.microsoft.com/en-us/partner-center/toc.json` → 200, 120 KB, 1151 hrefs, 328 under `developer/`. (`developer/toc.json` alone 404s — the whole-set TOC is the entry point.) |
| The coverage gap is real and measurable | 328 developer pages; 81 referenced by a scenario; 247 unreferenced. |

The source repository `MicrosoftDocs/partner-center-pr` is private, so raw markdown cannot be
fetched. The embedded metadata is sufficient and is what this design builds on. `microsoft-graph-docs`
is public, so Graph findings can additionally link to a GitHub compare view.

## Design

### 1. One extractor, one snapshot, pure checks

```text
Learn (network)  ── refresh ──►  src/docfacts/extract.ts  ──►  verification/doc-facts.json
                                  (pure: HTML → DocFacts)       (committed snapshot)
                                                                       │
                       ┌───────────────────────────────────────────────┤
                       ▼                     ▼                         ▼
                checks/drift.ts       checks/fields.ts          checks/coverage.ts
              (fresh ↔ snapshot)   (snapshot ↔ scenarios)      (TOC ↔ scenarios)
                       │                     │                         │
                       └────────────► doc-report.md ◄──────────────────┘
```

The extractor and every check live in `src/docfacts/` as TypeScript with vitest coverage;
`scripts/*.mjs` become thin CLI wrappers importing from `dist/`, matching the existing
`scripts/eval.mjs` idiom. HTML parsing is the fragile part of this system, so it belongs where the
test harness is — not in an untested `.mjs`.

The snapshot lives in a new top-level `verification/`, **not** in `data/`. `package.json`'s `files`
field publishes `data/` to npm, so a ~330-record tooling artifact placed there would ship to every
consumer of the package for zero runtime benefit. `verification/` stays out of `files`.

`data/doc-hashes.json` is retired in the same change — it is referenced only by
`scripts/check-docs.mjs`, `verification/doc-facts.json` supersedes it, and removing it also stops
publishing that artifact. The knowledge loader names its files explicitly rather than scanning the
directory, so neither the addition nor the removal disturbs it.

### 2. Two commands, split by network dependence

| Command | Network | Runs | Contents |
| --- | --- | --- | --- |
| `npm run check-pack` | no | every PR (`ci.yml`) | field verification + coverage report + eval, against the committed snapshot |
| `npm run check-docs` | yes | weekly (`check-docs.yml`) | fetch, compare against snapshot, write `doc-report.md` |
| `npm run check-docs:update` | yes | manual | as above, then write the snapshot |

This split is the practical payoff of committing the snapshot. Editing `scenarios.json` with a wrong
`path` fails in seconds on the contributor's own PR, offline and without flakiness, instead of
surfacing in a weekly job days later. The `check-docs` / `check-docs:update` pair keeps its current
semantics, so existing muscle memory transfers.

### 3. `DocFacts`

One normalized record per page:

```ts
interface DocFacts {
  url: string;                       // docUrl as it appears in the pack
  finalUrl: string;                  // after redirects — detects moved pages
  template: "partner-center" | "graph" | "unknown";
  documentId: string | null;         // page identity; a change means a wholesale rewrite
  sourceRepo: string | null;         // e.g. MicrosoftDocs/partner-center-pr
  sourceSha: string | null;          // 40-hex commit of the source markdown
  msDate: string | null;
  updatedAt: string | null;
  title: string | null;
  requestSyntax: { method: string; uri: string } | null;
  headerNames: string[];
  bodyFields: { name: string; type: string }[];
  isEndpointPage: boolean;           // === (requestSyntax !== null)
  extractionError: string | null;
  extractorVersion: number;
}
```

Two decisions carry weight here.

**`extractionError` is distinct from empty values.** If the extractor cannot read a page and leaves
the fields `null`, field verification would silently conclude "nothing to compare, all good" — the
most dangerous outcome this design can produce. An unreadable page is recorded as its own event, and
verification reports that scenario as *skipped*, never as *passing*.

**`extractorVersion` gates re-baselining.** Changing the parser changes every record in the snapshot.
The version field turns that into one deliberate re-baseline instead of ~330 phantom drifts.

Graph pages use a different template (an `HTTP request` code block rather than a
`Method | Request URI` table). `template` selects the reader; both produce the same shape.

`verification/doc-facts.json` is `{ version, extractorVersion, tocHrefs: string[], pages: Record<url,
DocFacts> }` — keyed by URL so diffs stay readable and record order never churns. It is
zod-validated on read, but by `src/docfacts/` and **not** by `src/knowledge/load.ts`: this is
build-time tooling data, never served to agents, and the running server must not pay to parse it.

### 4. Drift, with severity

Text hashing is removed. The signals become:

| Signal | Meaning |
| --- | --- |
| `sourceSha` changed | the source markdown changed |
| `documentId` changed | the page was replaced, not edited |
| `finalUrl` changed | the page moved |
| non-2xx/3xx | dead link (existing behaviour, retained) |
| `lastVerified` older than `STALE_DAYS` | staleness (existing behaviour, retained) |
| in `scenarios.json` but absent from the snapshot | never verified (replaces today's "unbaselined") |

Severity is what makes this usable:

- **High** — `requestSyntax`, `headerNames`, or `bodyFields` differ from the snapshot; or the page is
  dead, moved, or has a new `documentId`; or `extractionError` appeared where there was none.
  Exit 1; the weekly workflow opens an issue.
- **Low** — `sourceSha` changed but every field the pack depends on is byte-identical. Written to the
  report and the CI step summary; no issue, no red build.

`ms.date` moving on its own, with `sourceSha` unchanged, is not drift at all.

Today a prose typo fix in any of 95 pages opens an issue. Under this rule it does not, while a
changed request path — which today may not be noticed at all — does.

### 5. Field verification

For every scenario whose page yielded a `requestSyntax`:

- `method` vs `requestSyntax.method` — mismatch is an **error**.
- `path` vs `requestSyntax.uri`, after stripping the `{baseURL}` prefix and the trailing
  `HTTP/1.1` protocol token. The
  comparison treats `{…}` segments as wildcards but reports differing literal segments as an
  **error**. Segment-count differences are errors.
- `headers` vs `headerNames` — documented headers absent from the scenario are a **warning**, since
  many Partner Center pages delegate to a shared headers article rather than tabulating them.
- Pages with no `requestSyntax` (Graph, conceptual, or `extractionError`) are reported as **skipped**
  with the reason. Skipped is never counted as passed.

### 6. Coverage gap

`partner-center/toc.json` is fetched and every `developer/` href is snapshotted — all 328, not only
the 96 already referenced. Storing facts for uncovered pages is what makes the classification
possible at all, and it hands sub-project B a ready work list.

The TOC's href list is persisted into the snapshot alongside the page records, so the coverage
report — like field verification — runs offline in `check-pack` against committed data. Only the
weekly `check-docs` run re-reads `toc.json`.

The classifier is deterministic: **a page with a `Request syntax` table is an endpoint page.**

Two reports fall out:

- Endpoint pages with no scenario, grouped by TOC section — B's backlog, ordered by section size.
- Scenario `docUrl`s no longer present in the TOC — candidates for retirement.

### 7. Eval gate

`scripts/eval.mjs` gains a coverage assertion: every tool in `allTools` must have at least one case,
and missing tools are listed by name on failure. Cases are written for the tools currently
uncovered.

Assertions gain one precise form alongside `contains`/`notContains`:

```jsonc
{ "path": "method", "equals": "GET" }   // dotted path into the result, exact match
```

No new assertion language beyond that. `contains` stays for the cases where a substring is genuinely
what is being asserted.

### 8. CI wiring

- `ci.yml`: add `npm run check-pack` after `npm run build`. Blocking, offline, fast.
- `check-docs.yml`: unchanged cadence; now exits 1 (and opens an issue) only on high-severity
  findings. Low-severity findings accumulate in the step summary.
- Snapshot refresh stays manual (`npm run check-docs:update`). A bot that opens refresh PRs is out
  of scope for A.

### 9. Testing

`test/fixtures/docs/` holds four captured pages: a Partner Center endpoint page, a Partner Center
conceptual page, a Graph endpoint page, and a malformed/templateless page. Extractor tests assert the
complete `DocFacts` output for each. Check tests run over synthetic snapshots and synthetic
scenarios, offline.

These fixtures catch parser *regressions* — they cannot catch a Learn template *change*, because a
stale fixture keeps passing while live extraction degrades. The `extractionError` count in the weekly
run is what covers that: any non-zero extraction-failure rate is a high-severity finding. Both
mechanisms are required, and neither substitutes for the other.

## Sequencing

Each step is independently committable and leaves the tree green.

1. `src/docfacts/extract.ts` + fixtures + extractor tests. No behaviour change yet; the extractor is
   provably correct before anything depends on it.
2. `npm run check-docs:update` populates `verification/doc-facts.json` for the 95 existing `docUrl`s. Commit
   the snapshot on its own so the data lands as a reviewable diff.
3. `checks/fields.ts` + tests, and `npm run check-pack` wired into `ci.yml`. Whatever mismatches this
   surfaces on the existing pack are fixed here — expect real findings.
4. `checks/drift.ts` with the severity split; rewrite `scripts/check-docs.mjs` over it; delete
   `data/doc-hashes.json`.
5. TOC ingestion, snapshot extended to all 328 developer pages, `checks/coverage.ts` + tests.
6. Eval coverage gate, the `path`/`equals` assertion, and cases for the uncovered tools.
7. README updates for the new commands; release.

Step 3 precedes 4 deliberately: the severity rule in step 4 is defined in terms of field comparison,
so field comparison must exist and be trusted first.

## Risks

- **Learn changes its page template.** The whole design rests on the `gitcommit` meta tag,
  `document_id`, and the `Request syntax` table. Mitigated by the `extractionError` tripwire, which
  turns silent degradation into a high-severity finding. Not eliminated: a template change still
  costs a parser update.
- **Step 3 surfaces a pile of existing mismatches.** Likely, and the point of the exercise. Handled
  by fixing them inside step 3 rather than deferring, so `check-pack` lands green.
- **The snapshot grows the repo.** ~330 records. Accepted: it is the thing that makes every check
  offline, testable, and diffable, and it replaces `doc-hashes.json`.
- **Path normalization is the subtlest logic in the design.** Wildcard-vs-literal segment comparison
  can produce false positives if the docs use a different placeholder spelling than the pack. Covered
  by unit tests over the real 96 paths in step 3, where any disagreement is visible immediately.
- **Weekly fetch cost rises from 95 to ~330 pages.** At the existing concurrency of 6 this is minutes,
  not hours, on a weekly schedule.

## Verification

The work is done when, on a clean checkout:

- `npm ci && npm run lint && npm run build && npm test` passes on Node 20, 22, and 24.
- `npm run check-pack` exits 0 with zero field-verification errors across all 96 scenarios, and
  reports every skipped scenario with a reason.
- `npm run eval` fails if any tool in `allTools` lacks a case (verified by temporarily removing one),
  and passes with all cases present.
- `npm run check-docs` produces a report that separates high- from low-severity findings, and exits 0
  when only low-severity findings exist.
- `data/doc-hashes.json` is gone and nothing references it.
- The coverage report lists endpoint pages without scenarios, grouped by TOC section.
