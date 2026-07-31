# Subscription and Order Lifecycle Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Carry the full Partner Center subscription and order lifecycle in the knowledge pack — 41 new scenarios, a lifecycle state machine, two plan tools, and webhook reference facts — so a license manager can be built against the pack without reading Microsoft Learn.

**Architecture:** Data first, tools second. Scenarios are authored into `data/scenarios.json` in six batches, each verified against its own Microsoft Learn page by the existing `checkFields` machinery and each ratcheting `test/pack-ratchet.test.ts` upward. Only after the data lands do the three new tools (`pc_explain_lifecycle`, `pc_plan_subscription_change`, `pc_plan_order_lifecycle`) get built on top of it. Nothing calls Partner Center at runtime; every tool stays `OFFLINE`.

**Tech Stack:** TypeScript (ESM, `tsc`), Zod 4 schemas, Vitest, Biome, MCP SDK. Node >= 20.

## Global Constraints

- Every new tool carries the `OFFLINE` annotation from `src/util/schema.ts`. No runtime network access, no credentials.
- Every scenario `docUrl` uses the locale-less form `https://learn.microsoft.com/partner-center/developer/<slug>`. A `/en-us/` URL passes schema validation but reports as *unverified* and fails `test/pack-ratchet.test.ts`.
- Scenario `path` uses the pack's canonical placeholder spelling — `{customer-id}`, `{subscription-id}`, `{order-id}` — not the doc page's spelling (`{customer-tenant-id}`, `{id-for-subscription}`). `pathsMatch` treats placeholder segments as wildcards, so this verifies fine and keeps the pack internally consistent.
- `checkFields` verifies, per scenario: `docUrl` present in the snapshot, `method` exactly, `path` segment-by-segment (literals strict, placeholders wildcard), `api` vs page template, and warns on any header the docs tabulate that the scenario omits. Request body fields are **not** machine-verified — author them from the page's "Request body" table by hand.
- `test/integrity.test.ts` requires: unique ids; `path` starts with `/`; the `curl` example contains both the api host and the literal path prefix; all three examples non-empty; no `graph.windows.net`.
- `lastVerified` is the date the page was actually read: `2026-07-31`.
- Do not add a `Co-Authored-By` trailer to commits in this repo.
- After every data change run `npm run lint`, `npm test`, and `npm run check-pack`. All three must be clean before committing.

---

### Task 1: Doc-reading helper

Authoring 41 scenarios means reading 41 Learn pages. `npm run docfacts:refresh` rewrites the whole snapshot and prints nothing useful for authoring; there is no way today to read one page's tables.

**Files:**
- Create: `scripts/read-doc.mjs`
- Modify: `package.json` (scripts block)

**Interfaces:**
- Produces: `npm run read-doc -- <slug-or-url>` prints the page's visible text, tag-stripped and whitespace-collapsed, to stdout. Used by every scenario-authoring task that follows.

- [ ] **Step 1: Write the script**

```js
// Print one Microsoft Learn page as readable text, for authoring scenarios.
// Run: npm run read-doc -- create-scheduled-changes
const arg = process.argv[2];
if (!arg) {
  console.error("usage: npm run read-doc -- <doc-slug|url>");
  process.exit(2);
}
const url = arg.startsWith("http")
  ? arg
  : `https://learn.microsoft.com/en-us/partner-center/developer/${arg}`;
const res = await fetch(url);
if (!res.ok) {
  console.error(`${url}: HTTP ${res.status}`);
  process.exit(1);
}
const html = await res.text();
const body = html.slice(html.indexOf("<main"), html.indexOf("</main>"));
const text = body
  .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
  .replace(/<\/(p|div|tr|li|h[1-6]|table|section)>/gi, "\n")
  .replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
  .replace(/[ \t]+/g, " ")
  .replace(/\n{3,}/g, "\n\n");
console.log(`# ${url}\n${text.trim()}`);
```

- [ ] **Step 2: Register the script**

In `package.json`, inside `"scripts"`, after the `"docfacts:refresh"` line:

```json
    "read-doc": "node scripts/read-doc.mjs",
```

- [ ] **Step 3: Smoke-run it**

Run: `npm run read-doc -- create-scheduled-changes`
Expected: output begins with `# https://learn.microsoft.com/en-us/partner-center/developer/create-scheduled-changes` and contains the strings `Request syntax`, `PATCH`, and `scheduledNextTermInstructions`.

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add scripts/read-doc.mjs package.json
git commit -m "chore: add a Learn page reader for scenario authoring"
```

---

### Task 2: Lifecycle enums and resource fields

**Files:**
- Modify: `data/enums.json`
- Modify: `data/resources.json`
- Test: `test/data.test.ts`

**Interfaces:**
- Produces: enum keys `SubscriptionStatus`, `ProvisioningStatus`, `TransitionType`, `MigrationEventType`; resource keys `NewCommerceMigrationSchedule`, `Conversion`, `SupportContact`; new fields on the existing `Subscription` resource. Tasks 4–9 reference these from scenario `gotchas` and `requestFields`, and Task 11's lifecycle guards name the `Subscription` fields.

- [ ] **Step 1: Write the failing test**

Append to `test/data.test.ts`:

```ts
test("the lifecycle enums are present with their documented members", () => {
  const k = loadKnowledge("data");
  expect(Object.keys(k.enums)).toEqual(
    expect.arrayContaining(["SubscriptionStatus", "ProvisioningStatus", "TransitionType", "MigrationEventType"]),
  );
  const status = k.enums.SubscriptionStatus.values.map((v) => v.value);
  expect(status).toEqual(expect.arrayContaining(["active", "suspended", "deleted", "expired"]));
});

test("the Subscription resource documents the fields the lifecycle guards read", () => {
  const k = loadKnowledge("data");
  const fields = k.resources.Subscription.fields.map((f) => f.name);
  expect(fields).toEqual(expect.arrayContaining([
    "cancellationAllowedUntilDate", "refundOptions", "scheduledNextTermInstructions", "nickname",
  ]));
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/data.test.ts`
Expected: FAIL — `SubscriptionStatus` missing from enums.

- [ ] **Step 3: Add the enums**

Read the source pages first: `npm run read-doc -- subscription-resources`, `npm run read-doc -- get-subscription-provisioning-status`, `npm run read-doc -- get-migration-events`.

Add to the `enums` object in `data/enums.json`:

```json
    "SubscriptionStatus": {
      "description": "Lifecycle state of a subscription. Written via PATCH on the subscription; \"deleted\" is what a cancellation produces.",
      "values": [
        { "value": "active", "note": "provisioned and billing" },
        { "value": "suspended", "note": "set by the partner (suspend) or by Microsoft for non-payment; reactivate restores it" },
        { "value": "deleted", "note": "cancelled; for NCE only accepted inside the cancellation window" },
        { "value": "expired", "note": "term ended with autorenew off" }
      ],
      "docUrl": "https://learn.microsoft.com/partner-center/developer/subscription-resources"
    },
    "ProvisioningStatus": {
      "description": "Whether an order or subscription has finished provisioning at Microsoft's end.",
      "values": [
        { "value": "success", "note": "provisioned" },
        { "value": "pending", "note": "still provisioning; poll again" },
        { "value": "failed", "note": "provisioning failed; the order needs re-placing" }
      ],
      "docUrl": "https://learn.microsoft.com/partner-center/developer/get-subscription-provisioning-status"
    },
    "TransitionType": {
      "description": "How an NCE transition moves licenses to the target subscription.",
      "values": [
        { "value": "transition_only", "note": "move the subscription; licenses are not reassigned" },
        { "value": "transition_with_license_transfer", "note": "also move assigned user licenses to the target" }
      ],
      "docUrl": "https://learn.microsoft.com/partner-center/developer/transition-a-new-commerce-subscription"
    },
    "MigrationEventType": {
      "description": "Event kinds returned by the new commerce migration events endpoint.",
      "values": [
        { "value": "MigrationCompleted", "note": "the migration finished" },
        { "value": "MigrationFailed", "note": "the migration failed; read the error on the migration" },
        { "value": "MigrationScheduled", "note": "a scheduled migration was created" }
      ],
      "docUrl": "https://learn.microsoft.com/partner-center/developer/get-migration-events"
    }
```

Confirm every `value` against the page text before committing; correct the list if the docs disagree.

- [ ] **Step 4: Add the resource fields**

In `data/resources.json`, append to the `Subscription` resource's `fields` array:

```json
        { "name": "cancellationAllowedUntilDate", "type": "date", "note": "AUTHORITATIVE cancellation/seat-reduction deadline for this subscription. Read it; never hardcode a window length." },
        { "name": "refundOptions", "type": "RefundOption[]", "note": "type and expiry of the refund available if cancelled now" },
        { "name": "scheduledNextTermInstructions", "type": "object", "note": "product { billingCycle, termDuration, quantity } + customTermEndDate; applied at renewal, requires autoRenewEnabled true" },
        { "name": "nickname", "type": "string", "note": "partner-set display name; safe to PATCH on its own" },
        { "name": "hasPurchasableAddons", "type": "boolean", "note": "whether add-ons can be bought against this subscription" }
```

Then add three new resources alongside the existing ones:

```json
    "NewCommerceMigrationSchedule": {
      "description": "A scheduled legacy-to-NCE migration (response of create/get migration schedule).",
      "fields": [
        { "name": "id", "type": "string", "note": "schedule id, used on get/update/cancel" },
        { "name": "currentSubscriptionId", "type": "string (guid)", "note": "the legacy subscription to migrate" },
        { "name": "status", "type": "string", "note": "e.g. scheduled, completed, cancelled" },
        { "name": "targetDate", "type": "date", "note": "when the migration runs" },
        { "name": "migrateOnRenewal", "type": "boolean", "note": "run at the legacy term's renewal instead of a fixed date" }
      ],
      "docUrl": "https://learn.microsoft.com/partner-center/developer/schedule-a-new-commerce-migration"
    },
    "Conversion": {
      "description": "A legacy trial-to-paid conversion offer or result.",
      "fields": [
        { "name": "offerId", "type": "string", "note": "the paid offer the trial converts into" },
        { "name": "targetOfferId", "type": "string" },
        { "name": "quantity", "type": "int", "note": "seats on the paid subscription" },
        { "name": "billingCycle", "type": "string" }
      ],
      "docUrl": "https://learn.microsoft.com/partner-center/developer/convert-a-trial-subscription-to-paid"
    },
    "SupportContact": {
      "description": "The partner named as support contact on a subscription.",
      "fields": [
        { "name": "supportTenantId", "type": "string (guid)", "note": "tenant of the partner taking support" },
        { "name": "supportMpnId", "type": "string" },
        { "name": "name", "type": "string" }
      ],
      "docUrl": "https://learn.microsoft.com/partner-center/developer/get-a-subscription-s-support-contact"
    }
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run test/data.test.ts`
Expected: PASS.

- [ ] **Step 6: Full check**

Run: `npm run lint && npm test && npm run check-pack`
Expected: all clean. Scenario counts are untouched by this task, so the ratchet still reads 96/95.

- [ ] **Step 7: Commit**

```bash
git add data/enums.json data/resources.json test/data.test.ts
git commit -m "feat(data): document lifecycle enums and Subscription lifecycle fields"
```

---

### Tasks 3–8: The 41 scenarios, in six batches

All six batches follow the **same procedure**, which is stated here once and referenced by each task. Read it before starting any batch.

**Per-scenario procedure:**

1. `npm run read-doc -- <slug>` and read the whole page.
2. Author one entry in the `scenarios` array of `data/scenarios.json`, in the shape below.
3. `method` and the literal segments of `path` must match the page's "Request syntax" table exactly. Use the pack's canonical placeholder names.
4. `headers` must include every header the page's "Request headers" section tabulates, plus `Authorization` always and `Content-Type` on any request with a body. Missing ones produce a `field-header` warning in `check-pack`.
5. `requestFields` come from the "Request body" table. Where the page says a full resource must be sent, state that as the first field exactly as `update-subscription` does: `{ "name": "(full Subscription resource)", "type": "Subscription", "required": true, "note": "GET the subscription, mutate, then PATCH the whole object back" }`.
6. `gotchas` are the constraints the page states in prose, most consequential first. Two to four per scenario. These are the reason the pack exists — an endpoint without its constraints is worse than no entry.
7. `examples` — all three languages, following the exact style of the neighbouring entries. The curl example must contain the api host and the literal path prefix or `test/integrity.test.ts` fails.
8. `lastVerified`: `2026-07-31`.

**Worked example** — the first entry of Batch A, to copy the shape from:

```json
    {
      "id": "cancel-subscription",
      "area": "subscriptions",
      "title": "Cancel a new commerce or Marketplace subscription",
      "method": "PATCH",
      "path": "/v1/customers/{customer-id}/subscriptions/{subscription-id}",
      "authType": "app+user",
      "headers": [
        { "name": "Authorization", "required": true, "note": "Bearer token, audience https://api.partnercenter.microsoft.com" },
        { "name": "Content-Type", "required": true, "note": "application/json" }
      ],
      "requestShape": "Subscription",
      "requestFields": [
        { "name": "(full Subscription resource)", "type": "Subscription", "required": true, "note": "GET the subscription, mutate, then PATCH the whole object back" },
        { "name": "status", "type": "string", "required": true, "note": "set to \"deleted\" to cancel" }
      ],
      "responseShape": "Subscription",
      "examples": {
        "curl": "curl -X PATCH -H \"Authorization: Bearer $TOKEN\" -H \"Content-Type: application/json\" -d @subscription.json \"https://api.partnercenter.microsoft.com/v1/customers/{customer-id}/subscriptions/{subscription-id}\"",
        "csharp": "var req = new HttpRequestMessage(HttpMethod.Patch, $\"/v1/customers/{customerId}/subscriptions/{subscriptionId}\") { Content = content };\nvar res = await http.SendAsync(req);",
        "typescript": "const res = await fetch(`https://api.partnercenter.microsoft.com/v1/customers/${customerId}/subscriptions/${subscriptionId}`, { method: \"PATCH\", headers: { Authorization: `Bearer ${token}`, \"Content-Type\": \"application/json\" }, body });"
      },
      "gotchas": [
        "Only accepted while the subscription's cancellationAllowedUntilDate is in the future; read that field, do not assume a fixed window.",
        "Cancellation is a PATCH of the full resource with status \"deleted\" — there is no DELETE verb for a subscription.",
        "Refund behaviour is described by the subscription's refundOptions; check it before cancelling.",
        "Software purchases and reservations cancel at the ORDER, not here — use cancel-software-purchase."
      ],
      "docUrl": "https://learn.microsoft.com/partner-center/developer/cancel-an-azure-marketplace-subscription",
      "lastVerified": "2026-07-31"
    }
```

**Per-batch closing steps** (identical for every batch, `N` = the batch's new scenario count):

- Update `test/pack-ratchet.test.ts`: `expect(knowledge.scenarios.length).toBe(<old + N>)` and `expect(knowledge.scenarios.length - skipped).toBe(<old verified + N>)`. These numbers may only move up.
- Run `npm run check-pack`. Expected: no errors, no new skips. A `field-mismatch` error means the authored path or method disagrees with the docs — fix the scenario, never the expectation.
- Run `npm run lint && npm test`. All clean.
- Commit.

---

### Task 3: Batch A — seat, cancel, suspend, reactivate (6 scenarios, ratchet 96/95 → 102/101)

**Files:**
- Modify: `data/scenarios.json`
- Modify: `test/pack-ratchet.test.ts:41-42`
- Test: `test/lifecycle-scenarios.test.ts` (create)

**Interfaces:**
- Produces: scenario ids `change-subscription-quantity`, `cancel-subscription`, `cancel-software-purchase`, `cancel-order-sandbox`, `suspend-subscription`, `reactivate-subscription`. Task 11's lifecycle machine and Task 12's plan tools reference these ids verbatim.

| id | doc slug | area |
| --- | --- | --- |
| `change-subscription-quantity` | change-the-quantity-of-a-subscription | subscriptions |
| `cancel-subscription` | cancel-an-azure-marketplace-subscription | subscriptions |
| `cancel-software-purchase` | cancel-software-purchases | orders |
| `cancel-order-sandbox` | cancel-an-order-from-the-integration-sandbox | orders |
| `suspend-subscription` | suspend-a-subscription | subscriptions |
| `reactivate-subscription` | reactivate-a-suspended-a-subscription | subscriptions |

- [ ] **Step 1: Write the failing test**

Create `test/lifecycle-scenarios.test.ts`:

```ts
import { test, expect } from "vitest";
import { loadKnowledge } from "../src/knowledge/load.js";

const k = loadKnowledge("data");
const byId = new Map(k.scenarios.map((s) => [s.id, s]));

test("batch A: seat, cancel, suspend and reactivate are addressable by intent", () => {
  for (const id of [
    "change-subscription-quantity", "cancel-subscription", "cancel-software-purchase",
    "cancel-order-sandbox", "suspend-subscription", "reactivate-subscription",
  ]) {
    expect(byId.has(id), id).toBe(true);
  }
});

test("cancellation scenarios point at the authoritative window field, not a fixed duration", () => {
  const gotchas = byId.get("cancel-subscription")!.gotchas.join(" ");
  expect(gotchas).toContain("cancellationAllowedUntilDate");
  expect(gotchas).not.toMatch(/\b(7|72|168)\s*(day|days|hour|hours)\b/i);
});

test("seat reduction states the window constraint", () => {
  const gotchas = byId.get("change-subscription-quantity")!.gotchas.join(" ");
  expect(gotchas).toContain("cancellationAllowedUntilDate");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/lifecycle-scenarios.test.ts`
Expected: FAIL — `change-subscription-quantity` not found.

- [ ] **Step 3: Author the six scenarios**

Follow the per-scenario procedure above for each row of the table. Read all six pages first — `cancel-software-purchases` and `cancel-an-order-from-the-integration-sandbox` share the URI `PATCH /v1/customers/{customer-id}/orders/{order-id}` and differ only in intent and constraints, so their gotchas must make the difference explicit.

Required gotchas, stated because they are the whole point of these entries:

- `change-subscription-quantity`: seat **increases** are accepted any time and prorated; **decreases** only while `cancellationAllowedUntilDate` is in the future; the PATCH carries the full resource, so omitting `autoRenewEnabled` resets it to false.
- `cancel-subscription`: as in the worked example above.
- `cancel-software-purchase`: cancellation happens at the order with `status` `cancelled`; the subscription PATCH does not apply to software purchases; the order's own cancellation window governs.
- `cancel-order-sandbox`: integration-sandbox only; it is not a production cancellation path.
- `suspend-subscription`: suspension stops service but does **not** stop billing and is not a cancellation; billing ends only on cancellation inside the window.
- `reactivate-subscription`: only valid from `suspended`; a subscription suspended by Microsoft for non-payment cannot be reactivated by the partner until the underlying issue clears.

- [ ] **Step 4: Run the batch test**

Run: `npx vitest run test/lifecycle-scenarios.test.ts`
Expected: PASS.

- [ ] **Step 5: Ratchet up**

In `test/pack-ratchet.test.ts`, change line 41 to `expect(knowledge.scenarios.length).toBe(102);` and line 42 to `expect(knowledge.scenarios.length - skipped).toBe(101);`

- [ ] **Step 6: Verify against the docs**

Run: `npm run check-pack`
Expected: no errors, no new skips.

- [ ] **Step 7: Full check**

Run: `npm run lint && npm test`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add data/scenarios.json test/pack-ratchet.test.ts test/lifecycle-scenarios.test.ts
git commit -m "feat(pack): add seat, cancel, suspend and reactivate scenarios"
```

---

### Task 4: Batch B — renewal (4 scenarios, ratchet 102/101 → 106/105)

**Files:**
- Modify: `data/scenarios.json`
- Modify: `test/pack-ratchet.test.ts:41-42`
- Modify: `test/lifecycle-scenarios.test.ts`

**Interfaces:**
- Produces: `create-scheduled-changes`, `update-subscription-autorenew`, `get-custom-term-end-dates`, `update-software-billing-frequency`.

| id | doc slug | area |
| --- | --- | --- |
| `create-scheduled-changes` | create-scheduled-changes | subscriptions |
| `update-subscription-autorenew` | update-autorenew-for-an-azure-marketplace-subscription | subscriptions |
| `get-custom-term-end-dates` | custom-term-end-dates | subscriptions |
| `update-software-billing-frequency` | manage-billing-frequency-software-subs | subscriptions |

- [ ] **Step 1: Write the failing test**

Append to `test/lifecycle-scenarios.test.ts`:

```ts
test("batch B: renewal-time changes are addressable", () => {
  for (const id of [
    "create-scheduled-changes", "update-subscription-autorenew",
    "get-custom-term-end-dates", "update-software-billing-frequency",
  ]) {
    expect(byId.has(id), id).toBe(true);
  }
});

test("scheduled changes state the autorenew precondition", () => {
  const s = byId.get("create-scheduled-changes")!;
  expect(s.gotchas.join(" ")).toContain("autoRenewEnabled");
  expect(s.requestFields?.map((f) => f.name)).toEqual(
    expect.arrayContaining(["scheduledNextTermInstructions"]),
  );
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/lifecycle-scenarios.test.ts`
Expected: FAIL — `create-scheduled-changes` not found.

- [ ] **Step 3: Author the four scenarios**

Follow the per-scenario procedure. Required gotchas:

- `create-scheduled-changes`: term duration, billing cycle and quantity cannot change mid-term — this endpoint schedules them for the next term; `autoRenewEnabled` must be true or the instructions never apply; for end-of-sale-with-conversions offers the target `catalogItemId` comes from `transitionEligibilities` with `eligibilityType=scheduled`.
- `update-subscription-autorenew`: the PATCH carries the full resource, so `autoRenewEnabled` must be included on every PATCH to this subscription or it silently resets to false.
- `get-custom-term-end-dates`: used to co-terminate a new purchase with an existing subscription's end date; the returned dates are the only accepted `customTermEndDate` values.
- `update-software-billing-frequency`: software subscriptions only, not seat-based online services.

- [ ] **Step 4: Run the batch test**

Run: `npx vitest run test/lifecycle-scenarios.test.ts`
Expected: PASS.

- [ ] **Step 5: Ratchet up**

`test/pack-ratchet.test.ts`: `toBe(106)` and `toBe(105)`.

- [ ] **Step 6: Verify and commit**

```bash
npm run check-pack && npm run lint && npm test
git add data/scenarios.json test/pack-ratchet.test.ts test/lifecycle-scenarios.test.ts
git commit -m "feat(pack): add renewal and scheduled-change scenarios"
```

---

### Task 5: Batch C — upgrade, transition history, trial conversion (6 scenarios, ratchet 106/105 → 112/111)

**Files:**
- Modify: `data/scenarios.json`
- Modify: `test/pack-ratchet.test.ts:41-42`
- Modify: `test/lifecycle-scenarios.test.ts`

**Interfaces:**
- Produces: `get-subscription-upgrades`, `get-subscription-transitions`, `convert-trial-subscription`, `get-trial-conversion-offers`, `get-product-upgrade-eligibility`, `get-product-upgrade-status`.

| id | doc slug | area |
| --- | --- | --- |
| `get-subscription-upgrades` | transition-a-subscription | subscriptions |
| `get-subscription-transitions` | get-transitions | subscriptions |
| `convert-trial-subscription` | convert-a-trial-subscription-to-paid | subscriptions |
| `get-trial-conversion-offers` | get-a-list-of-trial-conversion-offers | subscriptions |
| `get-product-upgrade-eligibility` | get-eligibility-for-product-upgrade | subscriptions |
| `get-product-upgrade-status` | get-product-upgrade-status | subscriptions |

- [ ] **Step 1: Write the failing test**

Append to `test/lifecycle-scenarios.test.ts`:

```ts
test("batch C: upgrade and conversion paths are addressable", () => {
  for (const id of [
    "get-subscription-upgrades", "get-subscription-transitions", "convert-trial-subscription",
    "get-trial-conversion-offers", "get-product-upgrade-eligibility", "get-product-upgrade-status",
  ]) {
    expect(byId.has(id), id).toBe(true);
  }
});

test("the legacy upgrade path is distinguished from the NCE transition path", () => {
  expect(byId.get("get-subscription-upgrades")!.gotchas.join(" ")).toMatch(/legacy/i);
  expect(byId.get("get-subscription-transitions")!.gotchas.join(" ")).toContain("transitionEligibilities");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/lifecycle-scenarios.test.ts`
Expected: FAIL — `get-subscription-upgrades` not found.

- [ ] **Step 3: Author the six scenarios**

Required gotchas:

- `get-subscription-upgrades`: this is the **legacy** upgrade path (`GET .../upgrades`); New Commerce subscriptions use `get-subscription-transition-eligibilities` plus `create-subscription-transition` instead.
- `get-subscription-transitions`: returns transition **history**, not eligibility — eligibility is `transitionEligibilities`.
- `convert-trial-subscription` / `get-trial-conversion-offers`: legacy trial offers; NCE trials convert through the transition API.
- `get-product-upgrade-eligibility` / `get-product-upgrade-status`: both are POSTs on the partner-wide `/v1/productUpgrades` route, not under `/customers/{id}` — check the request syntax carefully, and note that the status call polls the upgrade started by `create-azure-plan-upgrade`.

- [ ] **Step 4: Run the batch test**

Run: `npx vitest run test/lifecycle-scenarios.test.ts`
Expected: PASS.

- [ ] **Step 5: Ratchet up**

`test/pack-ratchet.test.ts`: `toBe(112)` and `toBe(111)`.

- [ ] **Step 6: Verify and commit**

```bash
npm run check-pack && npm run lint && npm test
git add data/scenarios.json test/pack-ratchet.test.ts test/lifecycle-scenarios.test.ts
git commit -m "feat(pack): add upgrade, transition-history and trial-conversion scenarios"
```

---

### Task 6: Batch D — add-ons and order lifecycle (8 scenarios, ratchet 112/111 → 120/119)

**Files:**
- Modify: `data/scenarios.json`
- Modify: `test/pack-ratchet.test.ts:41-42`
- Modify: `test/lifecycle-scenarios.test.ts`

**Interfaces:**
- Produces: `get-subscription-addons`, `purchase-addon`, `create-cart-with-addons`, `create-order`, `update-cart`, `get-order-provisioning-status`, `get-subscription-provisioning-status`, `get-order-activation-link`.

| id | doc slug | area |
| --- | --- | --- |
| `get-subscription-addons` | get-a-list-of-add-ons-for-a-subscription | subscriptions |
| `purchase-addon` | purchase-an-add-on-to-a-subscription | orders |
| `create-cart-with-addons` | create-a-cart-with-add-ons | orders |
| `create-order` | create-an-order | orders |
| `update-cart` | update-a-cart | orders |
| `get-order-provisioning-status` | get-order-provisioning-status | orders |
| `get-subscription-provisioning-status` | get-subscription-provisioning-status | subscriptions |
| `get-order-activation-link` | get-activation-link-by-order-line-item | orders |

- [ ] **Step 1: Write the failing test**

Append to `test/lifecycle-scenarios.test.ts`:

```ts
test("batch D: the order lifecycle continues past checkout", () => {
  for (const id of [
    "get-subscription-addons", "purchase-addon", "create-cart-with-addons", "create-order",
    "update-cart", "get-order-provisioning-status", "get-subscription-provisioning-status",
    "get-order-activation-link",
  ]) {
    expect(byId.has(id), id).toBe(true);
  }
});

test("provisioning-status scenarios are GETs that read, never write", () => {
  expect(byId.get("get-order-provisioning-status")!.method).toBe("GET");
  expect(byId.get("get-subscription-provisioning-status")!.method).toBe("GET");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/lifecycle-scenarios.test.ts`
Expected: FAIL — `get-subscription-addons` not found.

- [ ] **Step 3: Author the eight scenarios**

Required gotchas:

- `create-order`: the direct order path; `create-cart` + `checkout-cart` is the preferred path for New Commerce because it validates and prices first.
- `purchase-addon`: an add-on is bought by PATCHing the base subscription's **order**, not by creating a standalone subscription; the base subscription must have `hasPurchasableAddons` true.
- `get-order-provisioning-status` / `get-subscription-provisioning-status`: checkout returning 200 does not mean provisioned; poll these before treating licenses as available.
- `get-order-activation-link`: only line items for products that require activation return a link.

- [ ] **Step 4: Run the batch test**

Run: `npx vitest run test/lifecycle-scenarios.test.ts`
Expected: PASS.

- [ ] **Step 5: Ratchet up**

`test/pack-ratchet.test.ts`: `toBe(120)` and `toBe(119)`.

- [ ] **Step 6: Verify and commit**

```bash
npm run check-pack && npm run lint && npm test
git add data/scenarios.json test/pack-ratchet.test.ts test/lifecycle-scenarios.test.ts
git commit -m "feat(pack): add add-on and order-lifecycle scenarios"
```

---

### Task 7: Batch E — New Commerce migration lifecycle (8 scenarios, ratchet 120/119 → 128/127)

**Files:**
- Modify: `data/scenarios.json`
- Modify: `test/pack-ratchet.test.ts:41-42`
- Modify: `test/lifecycle-scenarios.test.ts`

**Interfaces:**
- Produces: `validate-migration`, `get-migration`, `query-migrations`, `get-migration-events`, `create-migration-schedule`, `get-migration-schedule`, `update-migration-schedule`, `cancel-migration-schedule`.

| id | doc slug | area |
| --- | --- | --- |
| `validate-migration` | validate-subscription-for-migration | subscriptions |
| `get-migration` | get-new-commerce-migration | subscriptions |
| `query-migrations` | query-migrated-subscriptions | subscriptions |
| `get-migration-events` | get-migration-events | subscriptions |
| `create-migration-schedule` | schedule-a-new-commerce-migration | subscriptions |
| `get-migration-schedule` | get-a-new-commerce-migration-schedule | subscriptions |
| `update-migration-schedule` | update-a-new-commerce-migration-schedule | subscriptions |
| `cancel-migration-schedule` | cancel-a-new-commerce-migration-schedule | subscriptions |

- [ ] **Step 1: Write the failing test**

Append to `test/lifecycle-scenarios.test.ts`:

```ts
test("batch E: migration is a lifecycle, not a single POST", () => {
  for (const id of [
    "validate-migration", "get-migration", "query-migrations", "get-migration-events",
    "create-migration-schedule", "get-migration-schedule", "update-migration-schedule",
    "cancel-migration-schedule",
  ]) {
    expect(byId.has(id), id).toBe(true);
  }
});

test("migrate-to-new-commerce points at validation before migrating", () => {
  expect(byId.get("migrate-to-new-commerce")!.gotchas.join(" ")).toContain("validate-migration");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/lifecycle-scenarios.test.ts`
Expected: FAIL — `validate-migration` not found.

- [ ] **Step 3: Author the eight scenarios and cross-link the existing one**

Follow the per-scenario procedure. Then append a gotcha to the **existing** `migrate-to-new-commerce` entry: `"Call validate-migration first — it reports eligibility and the errors this POST would otherwise fail with."`

Required gotchas on the new entries:

- `validate-migration`: run before every migration; it returns eligibility plus the specific reason when a subscription cannot migrate.
- `query-migrations`: partner-wide, not per customer — note the path has no `{customer-id}` segment.
- `get-migration-events`: the audit trail of what a scheduled migration actually did; the only way to see a failure reason after the fact.
- `cancel-migration-schedule`: a POST to `.../schedules/{scheduleID}/cancel`, not a DELETE.

- [ ] **Step 4: Run the batch test**

Run: `npx vitest run test/lifecycle-scenarios.test.ts`
Expected: PASS.

- [ ] **Step 5: Ratchet up**

`test/pack-ratchet.test.ts`: `toBe(128)` and `toBe(127)`.

- [ ] **Step 6: Verify and commit**

```bash
npm run check-pack && npm run lint && npm test
git add data/scenarios.json test/pack-ratchet.test.ts test/lifecycle-scenarios.test.ts
git commit -m "feat(pack): add the new commerce migration lifecycle"
```

---

### Task 8: Batch F — transfer lifecycle and subscription attributes (9 scenarios, ratchet 128/127 → 137/136)

**Files:**
- Modify: `data/scenarios.json`
- Modify: `test/pack-ratchet.test.ts:41-42`
- Modify: `test/lifecycle-scenarios.test.ts`

**Interfaces:**
- Produces: `accept-transfer`, `reject-transfer`, `withdraw-transfer`, `update-transfer`, `list-customer-transfers`, `create-legacy-transfer`, `update-subscription-nickname`, `get-subscription-support-contact`, `update-subscription-support-contact`.

| id | doc slug | area |
| --- | --- | --- |
| `accept-transfer` | accept-a-transfer | subscriptions |
| `reject-transfer` | reject-a-transfer | subscriptions |
| `withdraw-transfer` | withdraw-a-transfer | subscriptions |
| `update-transfer` | update-a-transfer | subscriptions |
| `list-customer-transfers` | get-all-of-a-customer-s-transfers | subscriptions |
| `create-legacy-transfer` | create-a-transfer-legacy | subscriptions |
| `update-subscription-nickname` | update-the-nickname-for-a-subscription | subscriptions |
| `get-subscription-support-contact` | get-a-subscription-s-support-contact | subscriptions |
| `update-subscription-support-contact` | update-a-subscription-s-support-contact | subscriptions |

- [ ] **Step 1: Write the failing test**

Append to `test/lifecycle-scenarios.test.ts`:

```ts
test("batch F: the transfer lifecycle is complete on both sides", () => {
  for (const id of [
    "accept-transfer", "reject-transfer", "withdraw-transfer", "update-transfer",
    "list-customer-transfers", "create-legacy-transfer", "update-subscription-nickname",
    "get-subscription-support-contact", "update-subscription-support-contact",
  ]) {
    expect(byId.has(id), id).toBe(true);
  }
});

test("the legacy transfer entry says which side of the transfer calls it", () => {
  expect(byId.get("create-legacy-transfer")!.gotchas.join(" ")).toMatch(/legacy/i);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/lifecycle-scenarios.test.ts`
Expected: FAIL — `accept-transfer` not found.

- [ ] **Step 3: Author the nine scenarios**

Required gotchas:

- `accept-transfer` / `reject-transfer`: called by the **source** partner on a transfer the target partner created; `create-transfer` documents the other side.
- `withdraw-transfer`: a DELETE, and only the creating (target) partner can withdraw.
- `create-legacy-transfer`: legacy subscriptions only; New Commerce uses `create-transfer` with `transferType` 3.
- `update-subscription-nickname`: a full-resource PATCH like every other subscription write — include `autoRenewEnabled` or it resets.

- [ ] **Step 4: Run the batch test**

Run: `npx vitest run test/lifecycle-scenarios.test.ts`
Expected: PASS.

- [ ] **Step 5: Ratchet up**

`test/pack-ratchet.test.ts`: `toBe(137)` and `toBe(136)`.

- [ ] **Step 6: Verify and commit**

```bash
npm run check-pack && npm run lint && npm test
git add data/scenarios.json test/pack-ratchet.test.ts test/lifecycle-scenarios.test.ts
git commit -m "feat(pack): add the transfer lifecycle and subscription attribute scenarios"
```

---

### Task 9: Lifecycle error entries

**Files:**
- Modify: `data/errors.json`
- Test: `test/errorref.test.ts`

**Interfaces:**
- Produces: error entries whose `relatedScenarios` name the Batch A–F ids. Task 11's lifecycle guards reference these by `errorCode`.

- [ ] **Step 1: Write the failing test**

Append to `test/errorref.test.ts`:

```ts
test("the lifecycle rejections are decodable and point at the guard field", () => {
  const k = loadKnowledge("data");
  const byCode = new Map(k.errors.map((e) => [e.errorCode, e]));
  for (const code of ["800001", "800002", "800003"]) {
    expect(byCode.has(code), code).toBe(true);
  }
  expect(byCode.get("800001")!.remediation).toContain("cancellationAllowedUntilDate");
  for (const e of k.errors) {
    for (const id of e.relatedScenarios ?? []) {
      expect(k.scenarios.some((s) => s.id === id), `${e.errorCode} -> ${id}`).toBe(true);
    }
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/errorref.test.ts`
Expected: FAIL — code `800001` not found.

- [ ] **Step 3: Add the entries**

Read the codes off the docs first: `npm run read-doc -- error-codes`. **Use the real Partner Center codes the page lists for these conditions and replace the placeholders `800001`/`800002`/`800003` in both the data and the test above with them.** If the page does not tabulate a code for a condition, record the condition under the HTTP status the operation actually returns and say so in `description` rather than inventing a code.

Each entry covers one condition: cancellation attempted after `cancellationAllowedUntilDate`; seat reduction attempted after the same date; term duration or billing cycle change attempted mid-term. Every `remediation` names the field to read and the scenario to use instead (`create-scheduled-changes` for the mid-term case).

- [ ] **Step 4: Run the test**

Run: `npx vitest run test/errorref.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify and commit**

```bash
npm run lint && npm test && npm run check-pack
git add data/errors.json test/errorref.test.ts
git commit -m "feat(pack): decode the lifecycle rejection errors"
```

---

### Task 10: Fix the OpenAPI export's silent operation loss

Nine scenarios now share `PATCH /v1/customers/{customer-id}/subscriptions/{subscription-id}`. `scripts/export.mjs` writes `openapi.paths[key][method] = op`, so eight of them vanish from the generated spec without a word. OpenAPI cannot express nine operations on one path+method; the fix is to keep the first deterministically and record the rest, so nothing is lost silently.

**Files:**
- Modify: `scripts/export.mjs:30-51`
- Test: `test/export.test.ts` (create)

**Interfaces:**
- Produces: each OpenAPI operation may carry `x-variants: [{ operationId, summary, externalDocs }]` listing the scenarios that share its path and method.

- [ ] **Step 1: Write the failing test**

Create `test/export.test.ts`:

```ts
import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { loadKnowledge } from "../src/knowledge/load.js";

test("the generated OpenAPI spec loses no partner-center scenario", () => {
  const spec = JSON.parse(readFileSync("generated/openapi.json", "utf8"));
  const exported = new Set<string>();
  for (const methods of Object.values(spec.paths) as any[]) {
    for (const op of Object.values(methods) as any[]) {
      exported.add(op.operationId);
      for (const v of op["x-variants"] ?? []) exported.add(v.operationId);
    }
  }
  const expected = loadKnowledge("data").scenarios
    .filter((s) => (s.api ?? "partner-center") === "partner-center")
    .map((s) => s.id);
  expect([...expected].filter((id) => !exported.has(id))).toEqual([]);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run build && npm run export && npx vitest run test/export.test.ts`
Expected: FAIL — the eight subscription-PATCH variants are missing from `exported`.

- [ ] **Step 3: Record variants instead of overwriting**

In `scripts/export.mjs`, replace the final line of the OpenAPI loop (`openapi.paths[key][s.method.toLowerCase()] = op;`) with:

```js
  const verb = s.method.toLowerCase();
  const existing = openapi.paths[key][verb];
  if (existing) {
    // OpenAPI allows one operation per path+method; the pack deliberately holds
    // several intents on one URI (cancel/suspend/quantity are all PATCH on the
    // subscription). Keep the first and record the rest so nothing disappears.
    (existing["x-variants"] ??= []).push({ operationId: s.id, summary: s.title, externalDocs: { url: s.docUrl } });
  } else {
    openapi.paths[key][verb] = op;
  }
```

- [ ] **Step 4: Regenerate and re-run**

Run: `npm run export && npx vitest run test/export.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify and commit**

```bash
npm run lint && npm test
git add scripts/export.mjs generated/openapi.json generated/partner-center.postman_collection.json test/export.test.ts
git commit -m "fix(export): record OpenAPI operations that share a path and method"
```

---

### Task 11: The lifecycle state machine and `pc_explain_lifecycle`

**Files:**
- Create: `data/lifecycle.json`
- Create: `src/tools/explainLifecycle.ts`
- Create: `test/lifecycle.test.ts`
- Modify: `src/knowledge/schema.ts` (add `LifecycleSchema`, extend `Knowledge`)
- Modify: `src/knowledge/load.ts` (read the new file)
- Modify: `src/tools/index.ts` (register the tool)

**Interfaces:**
- Consumes: scenario ids from Tasks 3–8; error codes from Task 9.
- Produces: `LifecycleData` = `{ states: string[], operations: LifecycleOperation[] }` where `LifecycleOperation` = `{ operation: string, title: string, fromStates: string[], toState: string, scenarioId: string, guard: { field: string, condition: string } | null, errorCodes: string[], notes: string[] }`. Task 12's plan tool imports the same `operation` list.

- [ ] **Step 1: Write the failing test**

Create `test/lifecycle.test.ts`:

```ts
import { test, expect } from "vitest";
import { loadKnowledge } from "../src/knowledge/load.js";
import { explainLifecycle } from "../src/tools/explainLifecycle.js";
import type { ToolContext } from "../src/types.js";

const knowledge = loadKnowledge("data");
const ctx: ToolContext = { knowledge, docFetch: async () => ({ ok: true, excerpts: [] }) };

test("every lifecycle operation names a real scenario, error and state", () => {
  const ids = new Set(knowledge.scenarios.map((s) => s.id));
  const codes = new Set(knowledge.errors.map((e) => e.errorCode));
  const states = new Set(knowledge.lifecycle.states);
  for (const op of knowledge.lifecycle.operations) {
    expect(ids.has(op.scenarioId), `${op.operation} -> ${op.scenarioId}`).toBe(true);
    expect(states.has(op.toState), `${op.operation} -> ${op.toState}`).toBe(true);
    for (const from of op.fromStates) expect(states.has(from), `${op.operation} <- ${from}`).toBe(true);
    for (const code of op.errorCodes) expect(codes.has(code), `${op.operation} -> ${code}`).toBe(true);
  }
});

test("the nine lifecycle operations are all modelled", () => {
  const names = knowledge.lifecycle.operations.map((o) => o.operation).sort();
  expect(names).toEqual([
    "cancel", "decrease-seats", "increase-seats", "migrate", "reactivate",
    "renew-change", "suspend", "transfer", "upgrade",
  ]);
});

test("pc_explain_lifecycle returns the whole machine with no argument", async () => {
  const r = await explainLifecycle.run({}, ctx);
  expect(r.ok).toBe(true);
  expect((r.data as any).operations.length).toBe(9);
});

test("pc_explain_lifecycle narrows to one operation and states its guard", async () => {
  const r = await explainLifecycle.run({ operation: "decrease-seats" }, ctx);
  const data = r.data as any;
  expect(data.operations.length).toBe(1);
  expect(data.operations[0].guard.field).toBe("cancellationAllowedUntilDate");
});

test("pc_explain_lifecycle rejects an unknown operation", async () => {
  const r = await explainLifecycle.run({ operation: "nope" }, ctx);
  expect(r.ok).toBe(false);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/lifecycle.test.ts`
Expected: FAIL — cannot resolve `../src/tools/explainLifecycle.js`.

- [ ] **Step 3: Add the schema**

In `src/knowledge/schema.ts`, after `ResourcesSchema`:

```ts
export const LifecycleSchema = z.object({
  version: z.string(),
  states: z.array(z.string()).describe("Every state a subscription can be in."),
  operations: z.array(z.object({
    operation: z.string().describe("Stable operation name, e.g. \"decrease-seats\"."),
    title: z.string().describe("Human-readable name of the operation."),
    fromStates: z.array(z.string()).describe("States the operation is legal from."),
    toState: z.string().describe("State the subscription is in once it succeeds."),
    scenarioId: z.string().describe("Scenario that performs it; pass to pc_get_scenario."),
    guard: z.union([z.object({
      field: z.string().describe("Field to read off the live subscription before attempting the operation."),
      condition: z.string().describe("Condition that must hold for the operation to be accepted."),
    }), z.null()]).describe("Precondition to evaluate against the live subscription, or null when unconditional."),
    errorCodes: z.array(z.string()).describe("Error codes returned when the guard fails."),
    notes: z.array(z.string()).describe("Constraints worth knowing before calling."),
  })),
});

export type LifecycleData = z.infer<typeof LifecycleSchema>;
```

Add `lifecycle: LifecycleData;` to the `Knowledge` interface.

- [ ] **Step 4: Load it**

In `src/knowledge/load.ts`, import `LifecycleSchema`, add

```ts
  const lifecycle = read(dir, "lifecycle.json", LifecycleSchema);
```

and include `lifecycle` in the returned object.

- [ ] **Step 5: Write the data**

Create `data/lifecycle.json`. States: `active`, `suspended`, `deleted`, `expired`. Nine operations, wired to the ids authored above:

| operation | scenarioId | fromStates | toState | guard |
| --- | --- | --- | --- | --- |
| `increase-seats` | `change-subscription-quantity` | active | active | null |
| `decrease-seats` | `change-subscription-quantity` | active | active | `cancellationAllowedUntilDate` in the future |
| `upgrade` | `create-subscription-transition` | active | active | eligibility returned by `get-subscription-transition-eligibilities` |
| `cancel` | `cancel-subscription` | active, suspended | deleted | `cancellationAllowedUntilDate` in the future |
| `renew-change` | `create-scheduled-changes` | active | active | `autoRenewEnabled` is true |
| `suspend` | `suspend-subscription` | active | suspended | null |
| `reactivate` | `reactivate-subscription` | suspended | active | null |
| `migrate` | `migrate-to-new-commerce` | active | active | `validate-migration` reports eligible |
| `transfer` | `create-transfer` | active | active | null |

Each entry's `notes` restate the operation's hard constraints in one line each — for `decrease-seats`, that increases are unconditional but decreases are not; for `renew-change`, that mid-term changes are impossible and this schedules the next term. `errorCodes` reference the codes added in Task 9; use `[]` where no code applies.

- [ ] **Step 6: Write the tool**

Create `src/tools/explainLifecycle.ts`, following the shape of `src/tools/getReference.ts`:

```ts
import { z } from "zod";
import type { Tool, ToolResult } from "../types.js";
import type { Knowledge } from "../knowledge/schema.js";
import { ok, toolError } from "../util/result.js";
import { envelope, OFFLINE } from "../util/schema.js";

export const explainLifecycle: Tool = {
  name: "pc_explain_lifecycle",
  title: "Explain the subscription lifecycle",
  description:
    "Return the subscription lifecycle state machine: which operations (increase-seats, decrease-seats, upgrade, cancel, renew-change, suspend, reactivate, migrate, transfer) are legal from which state, the field to read off the live subscription before attempting each one, the scenario that performs it, and the errors a failed precondition returns. " +
    "Use this to answer \"what can I do to this subscription right now\" before reaching for an endpoint. For the endpoint itself use pc_get_scenario, and for an ordered call sequence use pc_plan_subscription_change. " +
    "Read-only, offline, deterministic. Omit `operation` for the whole machine.",
  inputShape: {
    operation: z.string().optional().describe(
      "Narrow the answer to one operation: increase-seats, decrease-seats, upgrade, cancel, renew-change, suspend, reactivate, migrate, or transfer. Omit to get every operation.",
    ),
  },
  outputShape: envelope(z.object({
    states: z.array(z.string()).describe("Every state a subscription can be in."),
    operations: z.array(z.unknown()).describe("The matching operations, each with fromStates, toState, scenarioId, guard, errorCodes and notes."),
  })),
  annotations: OFFLINE,
  run(args, ctx): ToolResult {
    const { states, operations } = (ctx.knowledge as Knowledge).lifecycle;
    if (args.operation === undefined) return ok({ states, operations });
    const match = operations.filter((o) => o.operation === args.operation);
    if (match.length === 0) {
      return toolError(`Unknown lifecycle operation "${args.operation}". Known: ${operations.map((o) => o.operation).join(", ")}.`);
    }
    return ok({ states, operations: match });
  },
};
```

- [ ] **Step 7: Register it**

In `src/tools/index.ts`, import `explainLifecycle` and add it to the `allTools` array after `getResource`.

- [ ] **Step 8: Run the tests**

Run: `npx vitest run test/lifecycle.test.ts`
Expected: PASS.

- [ ] **Step 9: Full check**

Run: `npm run build && npm run lint && npm test && npm run check-pack`
Expected: all clean. `test/registry.test.ts` and `test/structured-output.test.ts` pick the new tool up automatically.

- [ ] **Step 10: Commit**

```bash
git add data/lifecycle.json src/knowledge/schema.ts src/knowledge/load.ts src/tools/explainLifecycle.ts src/tools/index.ts test/lifecycle.test.ts
git commit -m "feat(tools): add the subscription lifecycle state machine"
```

---

### Task 12: `pc_plan_subscription_change` and `pc_plan_order_lifecycle`

**Files:**
- Modify: `src/tools/planWorkflows.ts`
- Modify: `src/tools/index.ts`
- Create: `test/plan-lifecycle.test.ts`

**Interfaces:**
- Consumes: scenario ids from Tasks 3–8; the operation names from Task 11.
- Produces: `makeOperationPlanTool(name, title, description, chains, notes)` where `chains` is `Record<string, { goal: string; steps: Step[] }>`; the two tools it builds.

- [ ] **Step 1: Write the failing test**

Create `test/plan-lifecycle.test.ts`:

```ts
import { test, expect } from "vitest";
import { loadKnowledge } from "../src/knowledge/load.js";
import { planSubscriptionChange, planOrderLifecycle } from "../src/tools/planWorkflows.js";
import type { ToolContext } from "../src/types.js";

const knowledge = loadKnowledge("data");
const ctx: ToolContext = { knowledge, docFetch: async () => ({ ok: true, excerpts: [] }) };

test("pc_plan_subscription_change plans a cancellation through the window check", async () => {
  const r = await planSubscriptionChange.run({ operation: "cancel" }, ctx);
  const data = r.data as any;
  expect(data.steps.map((s: any) => s.scenarioId)).toEqual([
    "get-subscription-by-id", "cancel-subscription", "get-subscription-provisioning-status",
  ]);
  expect(data.notes.join(" ")).toContain("cancellationAllowedUntilDate");
});

test("pc_plan_subscription_change covers every lifecycle operation", async () => {
  for (const op of knowledge.lifecycle.operations) {
    const r = await planSubscriptionChange.run({ operation: op.operation }, ctx);
    expect(r.ok, op.operation).toBe(true);
    expect((r.data as any).steps.length, op.operation).toBeGreaterThan(0);
  }
});

test("pc_plan_subscription_change rejects an unknown operation", async () => {
  const r = await planSubscriptionChange.run({ operation: "nope" }, ctx);
  expect(r.ok).toBe(false);
});

test("pc_plan_subscription_change substitutes the customer id into every step", async () => {
  const r = await planSubscriptionChange.run({ operation: "suspend", customerId: "c7f6e4b1-3a2d-4c5e-9f80-1b2c3d4e5f60" }, ctx);
  for (const step of (r.data as any).steps) {
    expect(step.path).not.toContain("{customer-id}");
    expect(step.url).toContain("c7f6e4b1-3a2d-4c5e-9f80-1b2c3d4e5f60");
  }
});

test("pc_plan_order_lifecycle runs from cart to provisioned subscriptions", async () => {
  const r = await planOrderLifecycle.run({}, ctx);
  const ids = (r.data as any).steps.map((s: any) => s.scenarioId);
  expect(ids).toEqual([
    "create-cart", "checkout-cart", "get-order-provisioning-status",
    "get-subscriptions-by-order", "get-subscription-provisioning-status",
  ]);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/plan-lifecycle.test.ts`
Expected: FAIL — `planSubscriptionChange` is not exported.

- [ ] **Step 3: Add the operation-keyed plan builder**

In `src/tools/planWorkflows.ts`, after `makePlanTool`:

```ts
/**
 * Same plan shape as makePlanTool, but the chain is selected by an `operation`
 * argument instead of being fixed. The subscription lifecycle is one tool with
 * nine branches, not nine tools: an agent choosing between them is choosing an
 * operation, and the choice reads better as an argument than as a tool name.
 */
function makeOperationPlanTool(
  name: string,
  title: string,
  description: string,
  chains: Record<string, { goal: string; steps: Step[]; notes: string[] }>,
): Tool {
  return {
    name,
    title,
    description,
    inputShape: {
      operation: z.enum(Object.keys(chains) as [string, ...string[]]).describe(
        `Which change to plan. One of: ${Object.keys(chains).join(", ")}.`,
      ),
      customerId: z.string().optional().describe(
        "Optional Partner Center customer tenant id (GUID). When supplied it is substituted for the {customer-id} placeholder in every step's path and url.",
      ),
    },
    outputShape: envelope(PlanData),
    annotations: OFFLINE,
    run(args, ctx) {
      const chain = chains[args.operation as string];
      if (!chain) return toolError(`Unknown operation "${args.operation}". Known: ${Object.keys(chains).join(", ")}.`);
      const k = ctx.knowledge as Knowledge;
      const steps = buildPlan(k, args.customerId, chain.steps);
      if (steps.length === 0) return toolError(`Workflow scenarios for ${name}/${args.operation} are missing from the knowledge pack.`);
      return ok({ goal: chain.goal, steps, notes: chain.notes });
    },
  };
}
```

- [ ] **Step 4: Define the two tools**

Still in `src/tools/planWorkflows.ts`, after the existing plan tools. Chains, with the `why` on each step naming what it establishes:

- `increase-seats`: `get-subscription-by-id` → `change-subscription-quantity`
- `decrease-seats`: `get-subscription-by-id` (read `cancellationAllowedUntilDate`) → `change-subscription-quantity`
- `upgrade`: `get-subscription-transition-eligibilities` → `create-subscription-transition` → `get-subscription-transitions`
- `cancel`: `get-subscription-by-id` → `cancel-subscription` → `get-subscription-provisioning-status`
- `renew-change`: `get-subscription-by-id` → `create-scheduled-changes`
- `suspend`: `get-subscription-by-id` → `suspend-subscription`
- `reactivate`: `get-subscription-by-id` → `reactivate-subscription`
- `migrate`: `validate-migration` → `migrate-to-new-commerce` → `get-migration`
- `transfer`: `create-transfer` → `get-transfer` → `list-customer-subscriptions`

`pc_plan_order_lifecycle` uses `makePlanTool` with the fixed chain `create-cart` → `checkout-cart` → `get-order-provisioning-status` → `get-subscriptions-by-order` → `get-subscription-provisioning-status`, and notes covering the order-level cancellation branch (`cancel-software-purchase`) and add-on purchase (`purchase-addon`).

Every chain's `notes` must carry the guard from `data/lifecycle.json` for that operation — `cancel` and `decrease-seats` name `cancellationAllowedUntilDate` explicitly, as the test asserts. Append `PLAN_BEHAVIOUR` to both descriptions as the existing tools do.

- [ ] **Step 5: Register both**

In `src/tools/index.ts`, extend the `planWorkflows.js` import with `planSubscriptionChange, planOrderLifecycle` and add them to `allTools`.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run test/plan-lifecycle.test.ts`
Expected: PASS.

- [ ] **Step 7: Full check**

Run: `npm run build && npm run lint && npm test && npm run check-pack`
Expected: all clean.

- [ ] **Step 8: Commit**

```bash
git add src/tools/planWorkflows.ts src/tools/index.ts test/plan-lifecycle.test.ts
git commit -m "feat(tools): plan subscription changes and the order lifecycle"
```

---

### Task 13: Webhook reference facts

**Files:**
- Modify: `data/reference.json`
- Modify: `src/knowledge/schema.ts` (`ReferenceSchema`)
- Modify: `src/tools/getReference.ts`
- Test: `test/tools-extra.test.ts`

**Interfaces:**
- Produces: `pc_get_reference` accepts the new topic `"webhooks"` and returns `{ registration, events, validation, docUrl }`.

- [ ] **Step 1: Write the failing test**

Append to `test/tools-extra.test.ts`:

```ts
test("pc_get_reference explains webhook-driven lifecycle notification", async () => {
  const r = await getReference.run({ topic: "webhooks" }, ctx);
  const data = r.data as any;
  expect(data.events.map((e: any) => e.name)).toEqual(
    expect.arrayContaining(["subscription-updated", "order-created"]),
  );
  expect(data.registration).toContain("/v1/webhooks/registration");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/tools-extra.test.ts`
Expected: FAIL — `webhooks` is not a member of the topic enum.

- [ ] **Step 3: Read the source pages**

Run: `npm run read-doc -- partner-center-webhooks` and `npm run read-doc -- partner-center-webhook-events`. Take the registration path, the event names, and the signature-validation requirement from the pages — do not write them from memory.

- [ ] **Step 4: Add the data**

Add a `webhooks` key to `data/reference.json`:

```json
  "webhooks": {
    "registration": "Register a callback with POST /v1/webhooks/registration (PUT to update, GET to read). Partner Center then POSTs a signed event to your URL when a registered resource changes — this is the alternative to polling subscriptions for lifecycle changes.",
    "events": [
      { "name": "subscription-updated", "purpose": "Fires when a subscription changes: quantity, status, autorenew, or a scheduled change applying at renewal." },
      { "name": "order-created", "purpose": "Fires when an order is created for one of your customers." }
    ],
    "validation": "Every delivery is signed; verify the signature against the registration's certificate before trusting the payload, and respond 2xx quickly — Partner Center retries on failure.",
    "docUrl": "https://learn.microsoft.com/partner-center/developer/partner-center-webhooks"
  }
```

Correct every field against the pages read in Step 3, and extend `events` with any other lifecycle-relevant event the events page lists.

- [ ] **Step 5: Extend the schema**

In `src/knowledge/schema.ts`, add to `ReferenceSchema`:

```ts
  webhooks: z.object({
    registration: z.string(),
    events: z.array(z.object({ name: z.string(), purpose: z.string() })),
    validation: z.string(),
    docUrl: z.string().url(),
  }),
```

- [ ] **Step 6: Extend the tool**

In `src/tools/getReference.ts`, add `"webhooks"` to the `topic` enum, document it in the enum's `.describe()` text alongside the existing topics, and add `case "webhooks": return ok(ref.webhooks);` to the switch.

- [ ] **Step 7: Run the tests**

Run: `npx vitest run test/tools-extra.test.ts`
Expected: PASS.

- [ ] **Step 8: Full check**

Run: `npm run build && npm run lint && npm test && npm run check-pack`
Expected: all clean.

- [ ] **Step 9: Commit**

```bash
git add data/reference.json src/knowledge/schema.ts src/tools/getReference.ts test/tools-extra.test.ts
git commit -m "feat(pack): document webhook-driven lifecycle notification"
```

---

### Task 14: Documentation, regenerated exports, and push

**Files:**
- Modify: `README.md`
- Modify: `generated/openapi.json`, `generated/partner-center.postman_collection.json`

- [ ] **Step 1: Update the README**

- The architecture diagram at `README.md:37` says `23 tools` — change to `26 tools`.
- Add three rows to the tool table (around `README.md:104-121`), in the style of the neighbouring rows:
  - `` `pc_explain_lifecycle` `` — What you can do to a subscription in its current state: legal operations, the field each precondition reads, and the errors a failed precondition returns.
  - `` `pc_plan_subscription_change` `` — Ordered call sequence for one lifecycle change: seats, upgrade, cancel, renewal changes, suspend, reactivate, migrate, transfer.
  - `` `pc_plan_order_lifecycle` `` — Ordered call sequence from cart to provisioned subscriptions, with the cancellation and add-on branches.
- Update any scenario count the README states to 137.

- [ ] **Step 2: Regenerate the exports**

Run: `npm run build && npm run export`
Expected: `generated/openapi.json` and `generated/partner-center.postman_collection.json` now include the 41 new scenarios.

- [ ] **Step 3: Full verification**

Run: `npm run build && npm run lint && npm test && npm run check-pack`
Expected: every command exits 0. Read the `check-pack` output and confirm it reports no errors and no new skips — do not rely on the exit code alone.

- [ ] **Step 4: Commit**

```bash
git add README.md generated/
git commit -m "docs: cover the lifecycle tools and regenerate the exports"
```

- [ ] **Step 5: Push**

```bash
git push origin master
```

Expected: the push succeeds. If the remote has moved, `git pull --rebase origin master`, re-run `npm test && npm run check-pack`, and push again.

---

## Self-Review

**Spec coverage.** Spec §1 (41 scenarios) → Tasks 3–8, one batch each, ids and doc slugs tabulated. Spec §2 (resources, enums, errors) → Tasks 2 and 9. Spec §3 (lifecycle machine and `pc_explain_lifecycle`) → Task 11. Spec §4 (plan tools) → Task 12. Spec §5 (webhooks as reference, not scenarios) → Task 13. Spec "Testing" → the ratchet is bumped in every batch task and the four named test files are created in Tasks 3, 11, 12 and 13.

**Beyond the spec.** Task 10 fixes an OpenAPI collision the spec did not anticipate: nine scenarios now share one path+method and `scripts/export.mjs` overwrites silently. Task 1 adds an authoring helper. Both are consequences of the spec's "one scenario per intent" decision rather than new scope.

**Known unknown.** Task 9's error codes are placeholders (`800001`–`800003`) pending the codes on the Learn error page; the task says explicitly to replace them in both the data and the test, and what to do if no code is documented.
