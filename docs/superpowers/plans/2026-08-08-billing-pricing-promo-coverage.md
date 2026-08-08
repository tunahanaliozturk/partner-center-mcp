# Billing, Pricing and Promotions Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the money half of the remaining coverage gap — 38 scenarios covering Azure consumption usage, spending budgets and overage, invoice and reconciliation extras, price sheets and margins, promotion eligibility, and partner analytics. Takes documented-endpoint coverage from 70% to roughly 87%.

**Architecture:** Knowledge-pack authoring only, same shape as the two slices before it. No new tools.

**Tech Stack:** JSON knowledge pack validated by Zod, Vitest, Biome.

## Global Constraints

- **The per-scenario authoring procedure lives in [`2026-07-31-subscription-order-lifecycle.md`](2026-07-31-subscription-order-lifecycle.md) under "Tasks 3–8".** Read it first; it is not repeated here.
- `docUrl` is the locale-less `https://learn.microsoft.com/partner-center/developer/<slug>`. `lastVerified: 2026-08-08`.
- **Three pages are hosted on `api.partner.microsoft.com`** (price sheet, offer matrix, FX rates). They must declare `"api": "pricing-and-referrals"`, or `checkFields` raises `field-api` for the origin mismatch. The partner-analytics pages under `/partner/v1/analytics` are on the same host and need the same declaration — check each page's stated URI rather than assuming.
- After every batch: `npm run check-pack` (0 field errors, no new skips), `npm run build && npm run export`, `npm run lint`, `npm test`, then commit.
- Do not add a `Co-Authored-By` trailer to commits in this repo.
- master is protected against force-push and deletion; ordinary pushes are unaffected.

## Excluded, and why

- `activate-sandbox-subscription-azure-marketplace-products` — integration-sandbox billing activation for Marketplace SaaS; a test-harness concern, not a billing operation.
- The two `traf-pcsvcadmin-prod.trafficmanager.net` delegated-admin pages, still unaddressable (see the previous slice's plan).

---

### Task 1: Batch K — Azure consumption usage (8 scenarios, ratchet 172/171 → 180/179)

| id | doc slug |
| --- | --- |
| `get-partner-usage-summary` | get-a-partner-usage-summary |
| `get-all-customers-usage-records` | get-a-customer-s-usage-records |
| `get-customer-usage-summary` | get-a-customer-usage-summary |
| `get-customer-subscriptions-usage-records` | get-a-customer-subscription-s-usage-records |
| `get-subscription-usage-summary` | get-a-customer-subscription-usage-summary |
| `get-subscription-meter-usage` | get-a-customer-subscription-meter-usage-records |
| `get-subscription-resource-usage` | get-a-customer-subscription-resource-usage-records |
| `get-subscription-monthly-usage` | get-all-monthly-usage-records-for-a-subscription |

All `area: invoicing`. Facts that must reach `gotchas`: these are **estimated, unbilled** consumption figures that do not reconcile to an invoice — say so on every entry, because treating them as billing truth is the mistake this family invites. Note the aggregation level each one answers (partner, all customers, one customer, one subscription, per meter, per resource, per month) so a caller picks the right one instead of the first that returns data. Several return `204` with `Retry-After` while data is being prepared.

- [ ] **Step 1: Write the failing test** — create `test/billing-coverage.test.ts` with the same `scenario()` helper used by `test/customer-admin.test.ts`, asserting all eight ids exist and that every one of them warns the figures are estimates.
- [ ] **Step 2: Run it, confirm it fails** — `npx vitest run test/billing-coverage.test.ts`
- [ ] **Step 3: Author the eight scenarios**
- [ ] **Step 4: Run the batch test, confirm it passes**
- [ ] **Step 5: Ratchet to 180/179**
- [ ] **Step 6: `npm run check-pack && npm run build && npm run export && npm run lint && npm test`, then commit** — `feat(pack): add Azure consumption usage scenarios`

---

### Task 2: Batch L — spending budget, overage and service costs (6 scenarios, ratchet 180/179 → 186/185)

| id | doc slug |
| --- | --- |
| `get-usage-budget` | get-a-customer-s-usage-spending-budget |
| `update-usage-budget` | update-a-customer-s-usage-spending-budget |
| `get-subscription-overage` | get-subscription-overage |
| `update-subscription-overage` | update-subscription-overage |
| `get-service-costs-summary` | get-a-customer-s-service-costs-summary |
| `get-service-costs-lineitems` | get-a-customer-s-service-costs-line-items |

Facts for `gotchas`: the spending budget is a **notification threshold, not a hard cap** — Azure keeps consuming past it; say that plainly. Overage governs where consumption beyond an Azure plan's commitment is billed. Service costs are per billing period and are the customer-facing view, distinct from the partner invoice.

- [ ] **Step 1: Write the failing test** — assert the six ids, and that `update-usage-budget` warns the budget does not stop consumption.
- [ ] **Step 2: Run it, confirm it fails**
- [ ] **Step 3: Author the six scenarios**
- [ ] **Step 4: Run the batch test, confirm it passes**
- [ ] **Step 5: Ratchet to 186/185**
- [ ] **Step 6: Verify and commit** — `feat(pack): add spending budget, overage and service cost scenarios`

---

### Task 3: Batch M — invoice and reconciliation extras (5 scenarios, ratchet 186/185 → 191/190)

| id | doc slug |
| --- | --- |
| `get-invoice-summaries` | get-invoice-summaries |
| `get-invoice-estimate-links` | get-invoice-estimate-links |
| `get-invoice-billed-consumption` | get-invoice-billed-consumption-lineitems |
| `get-invoice-unbilled-consumption` | get-invoice-unbilled-consumption-lineitems |
| `list-orders-by-billing-cycle` | get-a-list-of-orders-by-customer-and-billing-cycle-type |

Facts for `gotchas`: the consumption line-item routes are the `usagelineitems` counterpart of the `billinglineitems` entries already in the pack — name the sibling on both sides. `get-invoice-estimate-links` is the entry point to the async estimate export. Cross-link `pc_plan_reconciliation` and the v1→v2 migration note already in `pc_whats_new`.

- [ ] **Step 1: Write the failing test** — assert the five ids and that each consumption entry names its `billinglineitems` sibling.
- [ ] **Step 2: Run it, confirm it fails**
- [ ] **Step 3: Author the five scenarios**
- [ ] **Step 4: Run the batch test, confirm it passes**
- [ ] **Step 5: Ratchet to 191/190**
- [ ] **Step 6: Verify and commit** — `feat(pack): add invoice summary, estimate and consumption line-item scenarios`

---

### Task 4: Batch N — pricing, margins and promotions (8 scenarios, ratchet 191/190 → 199/198)

| id | doc slug | api |
| --- | --- | --- |
| `get-margins` | get-margins | partner-center |
| `download-margins` | download-margins | partner-center |
| `get-growth-margins` | get-growth-margins | partner-center |
| `get-growth-margin-by-id` | get-growth-margin-by-id | partner-center |
| `get-price-sheet` | get-a-price-sheet | **pricing-and-referrals** |
| `get-offer-matrix` | get-an-offer-matrix | **pricing-and-referrals** |
| `get-fx-rates` | get-foreign-exchange-rates | **pricing-and-referrals** |
| `verify-promotion-eligibility` | verify-promotion-eligibility | partner-center |

Facts for `gotchas`: `verify-promotion-eligibility` is the missing half of the promotion story — the pack can already list promotions (`get-promotions`, `get-promotion-by-id`) but could not tell whether a given customer and catalog item qualify. Cross-link all three. The price sheet, offer matrix and FX rate routes are OData-style `$value` downloads on a different host with a different token audience — say so, since a Partner Center token fails there.

- [ ] **Step 1: Write the failing test** — assert the eight ids, that the three `pricing-and-referrals` entries declare that api, and that `verify-promotion-eligibility` names `get-promotions`.
- [ ] **Step 2: Run it, confirm it fails**
- [ ] **Step 3: Author the eight scenarios**
- [ ] **Step 4: Run the batch test, confirm it passes**
- [ ] **Step 5: Ratchet to 199/198**
- [ ] **Step 6: Verify and commit** — `feat(pack): add pricing, margin and promotion-eligibility scenarios`

---

### Task 5: Batch O — partner analytics (11 scenarios, ratchet 199/198 → 210/209)

| id | doc slug |
| --- | --- |
| `get-subscription-analytics` | get-all-subscription-analytics |
| `get-subscription-analytics-filtered` | get-subscription-analytics-by-search-query |
| `get-subscription-analytics-grouped` | get-subscription-analytics-grouped-by-dates-or-terms |
| `get-indirect-reseller-analytics` | get-all-indirect-resellers-analytics |
| `get-referral-analytics` | get-all-referrals-analytics |
| `get-search-analytics` | get-all-search-analytics |
| `get-partner-licenses-usage` | get-partner-licenses-usage-information |
| `get-partner-licenses-deployment` | get-partner-licenses-deployment-information |
| `get-commercial-licenses-usage` | get-licenses-usage-information |
| `get-commercial-licenses-deployment` | get-licenses-deployment-information |
| `get-customer-licenses-deployment` | get-customer-licenses-deployment-information |

Facts for `gotchas`: there are **three overlapping licence-analytics families** — `/v1/analytics/licenses/*` (partner), `/v1/analytics/commercial/*/license/` (commercial), and `/v1/customers/{id}/analytics/licenses/*` (per customer). Each entry must say which scope it answers and name the siblings, because picking the wrong one silently answers a different question. Check each page's host: the `/partner/v1/analytics/*` routes are on `api.partner.microsoft.com`.

- [ ] **Step 1: Write the failing test** — assert the eleven ids and that each licence-analytics entry names its scope.
- [ ] **Step 2: Run it, confirm it fails**
- [ ] **Step 3: Author the eleven scenarios**
- [ ] **Step 4: Run the batch test, confirm it passes**
- [ ] **Step 5: Ratchet to 210/209**
- [ ] **Step 6: Verify and commit** — `feat(pack): add partner and licence analytics scenarios`

---

### Task 6: Release 0.15.0

- [ ] **Step 1:** `npm run build && npm run export`
- [ ] **Step 2:** README Coverage section — name billing, pricing, promotions and analytics; do not state a scenario count in prose.
- [ ] **Step 3:** Full verification: `npm run build && npm run lint && npm test && npm run check-pack && npm run eval`
- [ ] **Step 4:** Stamp `data/scenarios.json` version, `npm version 0.15.0 --no-git-tag-version`, commit, `git tag v0.15.0`, push both.
- [ ] **Step 5:** Confirm the Publish workflow, `npm view partner-center-mcp version`, then `gh release create v0.15.0`.

## Self-Review

**Coverage.** 8 + 6 + 5 + 8 + 11 = 38, matching the in-scope gap count. Ratchet numbers chain 172 → 180 → 186 → 191 → 199 → 210, each batch starting where the last ended, verified count trailing by the single accepted skip.

**Risk noted up front.** The `api` declaration on the `api.partner.microsoft.com` routes is the one thing in this slice that fails loudly if forgotten, so it is called out in Global Constraints and again in Tasks 4 and 5.
