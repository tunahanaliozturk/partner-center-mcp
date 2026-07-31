# Subscription and Order Lifecycle Coverage — Design

Date: 2026-07-31
Status: Approved
Scope: the lifecycle slice of sub-project B (coverage depth), as named in the doc-verification
design of 2026-07-28. B closes the gap between what Microsoft documents and what the pack carries;
this spec takes the subscription and order lifecycle portion of that gap and leaves the rest
(usage records, analytics, catalog, profiles, device policies, price sheets) for a later slice.

## Problem

A partner-facing license manager drives Partner Center through the whole life of a subscription:
add seats, remove seats, upgrade, suspend, reactivate, cancel, change what the subscription renews
into, migrate a legacy subscription to New Commerce, and move billing ownership between partners.
It also needs the order side of that story — whether a purchase actually provisioned, and how a
purchase is cancelled or extended with an add-on.

The pack does not carry that story. `checkCoverage` run against the committed snapshot reports
**143 documented endpoints with no scenario, 62 of them lifecycle-related**. What exists today is
the happy path: `update-subscription` (one PATCH covering quantity, status, and autorenew at once),
the NCE transition pair, `migrate-to-new-commerce` (POST only), and `create-transfer` /
`get-transfer`. Three consequences follow.

**Intent is not addressable.** Eight distinct documented operations — change quantity, suspend,
reactivate, cancel, update autorenew, schedule renewal changes, change software billing frequency,
set a nickname — all share the URI `PATCH /v1/customers/{id}/subscriptions/{id}`. The pack collapses
them into a single scenario whose title is "Update a subscription (quantity, status, autorenew)".
A caller who asks "how do I cancel" finds nothing, because cancellation is neither named nor
described anywhere in the pack.

**The rules are absent.** The endpoint is the easy half. The hard half is knowing that a seat
reduction is only accepted inside the cancellation window, that the window is stated per
subscription in `cancellationAllowedUntilDate` rather than by a fixed number of days, that term
duration and billing cycle cannot be changed mid-term but can be scheduled for the next term via
`scheduledNextTermInstructions`, and that `autoRenewEnabled` silently resets when omitted from the
PATCH body. None of this is retrievable today.

**The order side stops at checkout.** `checkout-cart` returns an order; nothing tells the caller
how to find out whether that order provisioned, how to get an activation link for a line item, or
how a software purchase is cancelled (at the order, not the subscription).

## Scope

In: subscription lifecycle, order lifecycle, add-ons, New Commerce migration lifecycle, and
transfer lifecycle. (Webhook-based notification was in scope when this spec was written; it was
built and then cut on 2026-07-31 — see section 5.)

Out, deliberately:

- Azure-entitlement operations (`azureEntitlements/{id}/cancel` and `/reactivate`) and the
  Marketplace sandbox activation endpoint. These are Azure-plan mechanics, not license lifecycle.
- Usage records, usage summaries, overage, and subscription analytics. Reporting, not lifecycle.
- `POST /v1/customers/{id}/promotionEligibilities`. Renewal-adjacent but a pricing concern; it
  belongs with the catalog slice.

## Design

### 1. Scenario additions — 41 entries, 96 → 137

Every entry uses the existing `ScenarioSchema` unchanged and points at its own Microsoft Learn
page. All 41 pages are already present in `verification/doc-facts.json` with a parsed
`requestSyntax`, so each one is verified by `checkFields` the moment it lands — no snapshot refresh
is required and no new accepted skip is introduced. `checkFields` looks a scenario up by exact
`docUrl` string, so each entry must state the locale-less form
`https://learn.microsoft.com/partner-center/developer/<slug>`; a `/en-us/` URL parses and passes
schema validation but silently reports as unverified.

**One scenario per documented intent, not per URI.** The eight PATCH-on-subscription operations
become eight scenarios with intent-named ids (`cancel-subscription`, `suspend-subscription`,
`reactivate-subscription`, `change-subscription-quantity`, …), each carrying the request fields and
gotchas its own doc page states. This is what makes the pack searchable by intent, and it keeps
verification honest: each scenario is checked against the page that documents it. The existing
`update-subscription` entry stays as the generic read-modify-write description and gains a gotcha
pointing at the intent-specific entries.

| Group | Scenarios (doc slug) |
| --- | --- |
| Seat | change-the-quantity-of-a-subscription |
| Cancel | cancel-an-azure-marketplace-subscription, cancel-software-purchases, cancel-an-order-from-the-integration-sandbox |
| Suspend / reactivate | suspend-a-subscription, reactivate-a-suspended-a-subscription |
| Renew | create-scheduled-changes, update-autorenew-for-an-azure-marketplace-subscription, custom-term-end-dates, manage-billing-frequency-software-subs |
| Upgrade / convert | transition-a-subscription, get-transitions, convert-a-trial-subscription-to-paid, get-a-list-of-trial-conversion-offers, get-eligibility-for-product-upgrade, get-product-upgrade-status |
| Add-on | get-a-list-of-add-ons-for-a-subscription, purchase-an-add-on-to-a-subscription, create-a-cart-with-add-ons |
| Order | create-an-order, update-a-cart, get-order-provisioning-status, get-subscription-provisioning-status, get-activation-link-by-order-line-item |
| Migration | validate-subscription-for-migration, get-new-commerce-migration, query-migrated-subscriptions, get-migration-events, schedule-a-new-commerce-migration, get-a-new-commerce-migration-schedule, update-a-new-commerce-migration-schedule, cancel-a-new-commerce-migration-schedule |
| Transfer | accept-a-transfer, reject-a-transfer, withdraw-a-transfer, update-a-transfer, get-all-of-a-customer-s-transfers, create-a-transfer-legacy |
| Subscription attributes | update-the-nickname-for-a-subscription, get-a-subscription-s-support-contact, update-a-subscription-s-support-contact |

### 2. Supporting knowledge files

- **`data/resources.json`** — `Subscription` gains `cancellationAllowedUntilDate`, `refundOptions`,
  `scheduledNextTermInstructions`, `renewsTo`, `nickname`, and `hasPurchasableAddons`. New
  resources: `NewCommerceMigrationSchedule`, `Conversion`, `SupportContact`, `ProvisioningStatus`.
- **`data/enums.json`** — `SubscriptionStatus`, `ProvisioningStatus`, `TransitionType`,
  `MigrationEventType`, `CancellationReason`.
- **`data/errors.json`** — the rejections this slice provokes: cancellation attempted outside the
  window, seat reduction outside the window, mid-term change of term duration or billing cycle,
  migration validation failure. Each links `relatedScenarios` to the new entries.

### 3. Lifecycle rules — `data/lifecycle.json` and `pc_explain_lifecycle`

The question a license manager actually asks is not "what is the endpoint" but **"what can I do to
this subscription right now, and what decides that?"** A flat scenario list cannot answer it.

`data/lifecycle.json` holds a state machine, validated by a new Zod schema alongside the existing
ones in `src/knowledge/schema.ts`:

- **states**: `active`, `suspended`, `deleted`, `expired`
- **operations**: `increase-seats`, `decrease-seats`, `upgrade`, `cancel`, `renew-change`,
  `suspend`, `reactivate`, `migrate`, `transfer`

Each operation declares: the states it is legal from, a **guard** stated as the subscription field
to read and the condition to apply (seat reduction → `cancellationAllowedUntilDate` must not have
passed), the `scenarioId` that performs it, the resulting state, and the error entry raised when
the guard fails.

`pc_explain_lifecycle` is an offline tool taking an optional `operation`. With no argument it
returns the whole machine; with one it returns that operation's guards, scenario, and errors. It
carries the same `OFFLINE` annotation as every other tool.

Guards are expressed as data the caller reads off a live subscription, never as hardcoded
durations. Microsoft has changed the cancellation window before; `cancellationAllowedUntilDate` is
the authority and the pack says so rather than restating a number that will rot.

### 4. Plan tools

- **`pc_plan_subscription_change`** — takes an `operation` from the same enum as the lifecycle
  machine and returns that operation's ordered chain. Cancellation, for example: read the
  subscription → check `cancellationAllowedUntilDate` and `refundOptions` → PATCH → confirm via
  provisioning status.
- **`pc_plan_order_lifecycle`** — cart → checkout → order provisioning status → resolve the
  resulting subscriptions → activation link, with the order-level cancellation path for software
  purchases as a branch note.

`makePlanTool` in `src/tools/planWorkflows.ts` binds one fixed chain per tool. It gains a sibling,
`makeOperationPlanTool`, that binds a map of operation → chain and selects on the argument. The six
existing plan tools are untouched.

### 5. Webhooks — dropped

**Status: cut on 2026-07-31 by the repository owner, after being built.** A `webhooks` block was
added to `data/reference.json` and surfaced through `pc_get_reference`, then removed again: this
pack documents the request/response surface of the REST API, and event delivery is a different
concern that does not belong in it. The commit that removed it is the record; nothing in the pack
references webhooks now.

The original reasoning is kept here only to explain why webhooks were never scenarios in the first
place: `developer/partner-center-webhooks` and `developer/partner-center-webhook-events` are
conceptual pages carrying no request syntax, so modelling them as scenarios would have forced a
second entry onto the accepted-skip list in `test/pack-ratchet.test.ts`.

## Testing

- `npm run check-pack` must stay clean: every new scenario verified against its own doc page, no
  new errors, no new skips.
- `test/pack-ratchet.test.ts`: scenario count 96 → 137 and verified count 95 → 136, skip count
  unchanged at 1, accepted-skip list unchanged at `["get-invoice-billed-lineitems"]`.
- New `test/lifecycle.test.ts`: `data/lifecycle.json` parses; every `scenarioId` it names resolves
  to a real scenario; every error it names resolves to a real error entry; every operation reaches
  a declared state.
- New tool tests in the existing style: `pc_explain_lifecycle` with and without `operation`;
  `pc_plan_subscription_change` for each operation; `pc_plan_order_lifecycle`.
- `test/registry.test.ts` and `test/integrity.test.ts` pick up the three new tools through their
  existing assertions over `allTools`.

## Non-goals

No live Partner Center calls. Every tool stays `OFFLINE`; the server holds no credentials, makes no
network request at tool time, and continues to answer from the bundled pack alone.
