# Customer and User Administration Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the customer-and-user-administration half of the remaining coverage gap — 35 scenarios covering customer identity and profiles, users and roles, partner relationships, agreements, self-serve policies, and the Autopilot device/policy operations the pack starts but does not finish.

**Architecture:** Pure knowledge-pack authoring, no new tools. Identical shape and procedure to the lifecycle slice of 2026-07-31: one scenario per documented intent, each anchored to its own Microsoft Learn page and verified by `checkFields` against the committed snapshot, with `test/pack-ratchet.test.ts` ratcheted up per batch.

**Tech Stack:** JSON knowledge pack validated by Zod, Vitest, Biome. No source changes expected.

## Global Constraints

- **The per-scenario authoring procedure is defined in [`2026-07-31-subscription-order-lifecycle.md`](2026-07-31-subscription-order-lifecycle.md) under "Tasks 3–8".** Read it before authoring; it is not repeated here. In short: `npm run read-doc -- <slug>`, match `method` and the literal path segments exactly, use the pack's canonical placeholder spelling, declare every tabulated header, take `requestFields` from the request-body table, write two to four `gotchas` from the page's prose, all three examples, `lastVerified: 2026-08-01`.
- `docUrl` must be the locale-less form `https://learn.microsoft.com/partner-center/developer/<slug>`.
- `area` comes from the existing `AREAS` enum in `src/knowledge/schema.ts`. This slice uses `customers`, `licenses`, `devices`, `profiles` and `security` — no new area is introduced.
- After every batch: `npm run check-pack` (0 field errors, no new skips), `npm run lint`, `npm test`, then commit.
- Do not add a `Co-Authored-By` trailer to commits in this repo.

## Excluded, and why

These appeared in the raw gap list for this area and are deliberately not in this plan:

- `get-delegated-admin-relation-statistics` and `list-delegated-admin-customers` — documented against `https://traf-pcsvcadmin-prod.trafficmanager.net`, a host the pack's `api` enum cannot express. `checkFields` raises `field-api` for an origin mismatch, so adding them would need a fourth api id for a legacy host whose Graph replacement (`list-delegated-admin-customers` via `tenantRelationships/delegatedAdminCustomers`) is already in the pack.
- `sandbox-scenario` — the same `DELETE /v1/customers/{id}` endpoint and intent as the existing `delete-customer-sandbox`.
- `get-a-customer-s-service-costs-summary`, `get-a-customer-s-service-costs-line-items` — billing slice.
- `get-customer-licenses-deployment-information` — analytics slice.
- `get-subscription-overage`, `update-subscription-overage` — Azure consumption, not license administration.
- `verify-promotion-eligibility` — catalog/pricing slice.

---

### Task 1: Batch G — customer identity, profiles and validation (10 scenarios, ratchet 137/136 → 147/146)

**Files:**
- Modify: `data/scenarios.json`
- Modify: `test/pack-ratchet.test.ts:41-42`
- Test: `test/customer-admin.test.ts` (create)

**Interfaces:**
- Produces: scenario ids `search-customers`, `get-customer-company-profile`, `get-customer-billing-profile`, `update-customer-billing-profile`, `get-customer-organization`, `get-customer-custom-domains`, `add-verified-domain`, `get-customer-validation-status`, `get-partner-validation-codes`, `get-country-validation-rules`.

| id | doc slug | area |
| --- | --- | --- |
| `search-customers` | get-a-customer-by-name | customers |
| `get-customer-company-profile` | get-a-customer-s-company-profile | customers |
| `get-customer-billing-profile` | get-all-of-a-customer-s-billing-profiles | customers |
| `update-customer-billing-profile` | update-a-customer-s-billing-profile | customers |
| `get-customer-organization` | get-customer-organization | customers |
| `get-customer-custom-domains` | get-customer-custom-domain | customers |
| `add-verified-domain` | add-a-verified-domain-for-a-customer | customers |
| `get-customer-validation-status` | retrieve-validation-status | customers |
| `get-partner-validation-codes` | get-a-partner-s-validation-codes | customers |
| `get-country-validation-rules` | get-market-specific-validation-data | utilities |

- [ ] **Step 1: Write the failing test**

Create `test/customer-admin.test.ts`:

```ts
import { test, expect } from "vitest";
import { loadKnowledge } from "../src/knowledge/load.js";

const k = loadKnowledge("data");
const byId = new Map(k.scenarios.map((s) => [s.id, s]));

function scenario(id: string) {
  const found = byId.get(id);
  if (!found) throw new Error(`no scenario "${id}" in the pack`);
  return found;
}

test("batch G: customer identity, profiles and validation are addressable", () => {
  for (const id of [
    "search-customers", "get-customer-company-profile", "get-customer-billing-profile",
    "update-customer-billing-profile", "get-customer-organization", "get-customer-custom-domains",
    "add-verified-domain", "get-customer-validation-status", "get-partner-validation-codes",
    "get-country-validation-rules",
  ]) {
    expect(byId.has(id), id).toBe(true);
  }
});

test("the billing profile is written with PUT, not PATCH", () => {
  expect(scenario("update-customer-billing-profile").method).toBe("PUT");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/customer-admin.test.ts`
Expected: FAIL — `search-customers` not found.

- [ ] **Step 3: Author the ten scenarios**

Follow the procedure named in Global Constraints. Facts that must land in `gotchas`, because they are what the pages warn about:

- `search-customers` and the existing `list-customers` share `GET /v1/customers`; this entry is the filtered form. State the filter shape (`{"Field":"CompanyName","Value":"...","Operator":"starts_with"}`, URL-encoded) — an unencoded filter is the usual 400.
- `update-customer-billing-profile`: a PUT of the full profile, and it carries an ETag concern — re-read before writing (error `2055`).
- `add-verified-domain`: the domain has to be verified in the customer tenant first; this endpoint records it, it does not perform verification.
- `get-customer-validation-status` / `get-partner-validation-codes`: these gate transacting for customers under review; link them to error `800075`.
- `get-country-validation-rules`: the source of the address format `validate-address` enforces — call it before building an address form.

- [ ] **Step 4: Run the batch test**

Run: `npx vitest run test/customer-admin.test.ts`
Expected: PASS.

- [ ] **Step 5: Ratchet up**

`test/pack-ratchet.test.ts`: `toBe(147)` and `toBe(146)`.

- [ ] **Step 6: Verify and commit**

```bash
npm run check-pack && npm run lint && npm test
git add data/scenarios.json test/pack-ratchet.test.ts test/customer-admin.test.ts
git commit -m "feat(pack): add customer identity, profile and validation scenarios"
```

---

### Task 2: Batch H — users, roles and partner relationships (8 scenarios, ratchet 147/146 → 155/154)

**Files:**
- Modify: `data/scenarios.json`
- Modify: `test/pack-ratchet.test.ts:41-42`
- Modify: `test/customer-admin.test.ts`

**Interfaces:**
- Produces: `get-user-by-id`, `get-user-roles`, `update-user-accounts`, `list-deleted-users`, `remove-reseller-relationship`, `remove-delegated-admin`, `create-indirect-reseller-customer`, `list-indirect-reseller-customers`.

| id | doc slug | area |
| --- | --- | --- |
| `get-user-by-id` | get-a-user-account-by-id | customers |
| `get-user-roles` | get-user-roles-for-a-customer | customers |
| `update-user-accounts` | update-user-accounts-for-a-customer | customers |
| `list-deleted-users` | view-a-deleted-user | customers |
| `remove-reseller-relationship` | remove-a-reseller-relationship-with-a-customer | customers |
| `remove-delegated-admin` | remove-dap | security |
| `create-indirect-reseller-customer` | create-a-customer-for-an-indirect-reseller | customers |
| `list-indirect-reseller-customers` | get-customers-of-an-indirect-reseller | customers |

- [ ] **Step 1: Write the failing test**

Append to `test/customer-admin.test.ts`:

```ts
test("batch H: users, roles and partner relationships are addressable", () => {
  for (const id of [
    "get-user-by-id", "get-user-roles", "update-user-accounts", "list-deleted-users",
    "remove-reseller-relationship", "remove-delegated-admin",
    "create-indirect-reseller-customer", "list-indirect-reseller-customers",
  ]) {
    expect(byId.has(id), id).toBe(true);
  }
});

test("the two relationship removals are told apart, since they share a URI", () => {
  const reseller = scenario("remove-reseller-relationship");
  const dap = scenario("remove-delegated-admin");
  expect(reseller.path).toBe(dap.path);
  expect(reseller.gotchas.join(" ")).toMatch(/billing|reseller/i);
  expect(dap.gotchas.join(" ")).toMatch(/admin|GDAP|delegated/i);
});

test("deleted users are found through the filtered user list", () => {
  expect(scenario("list-deleted-users").path).toContain("filter");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/customer-admin.test.ts`
Expected: FAIL — `get-user-by-id` not found.

- [ ] **Step 3: Author the eight scenarios**

Facts that must land in `gotchas`:

- `remove-reseller-relationship` and `remove-delegated-admin` are both `PATCH /v1/customers/{customer-id}/` and differ only in the body. Each entry must say plainly which one it is and what the other does — this is the pair most likely to be confused, and getting it wrong severs the wrong thing.
- `remove-reseller-relationship` ends billing ownership; it is irreversible without the customer re-accepting an invitation (`get-reseller-relationship-url`).
- `create-indirect-reseller-customer` is `POST /v1/customers` like `create-customer`, but the body names the indirect reseller — say which field and that the provider calls it.
- `list-deleted-users` is the user list with a filter selecting soft-deleted accounts; cross-link `restore-user` and the 30-day window already documented on `delete-user`.
- `update-user-accounts` is a PATCH on the collection route (`/users`, no id) — note it against the per-user `PATCH /users/{user-id}` the pack already has.

- [ ] **Step 4: Run the batch test**

Run: `npx vitest run test/customer-admin.test.ts`
Expected: PASS.

- [ ] **Step 5: Ratchet up**

`test/pack-ratchet.test.ts`: `toBe(155)` and `toBe(154)`.

- [ ] **Step 6: Verify and commit**

```bash
npm run check-pack && npm run lint && npm test
git add data/scenarios.json test/pack-ratchet.test.ts test/customer-admin.test.ts
git commit -m "feat(pack): add user administration and relationship-removal scenarios"
```

---

### Task 3: Batch I — agreements, self-serve policies and managed services (9 scenarios, ratchet 155/154 → 164/163)

**Files:**
- Modify: `data/scenarios.json`
- Modify: `test/pack-ratchet.test.ts:41-42`
- Modify: `test/customer-admin.test.ts`

**Interfaces:**
- Produces: `get-customer-consent`, `get-agreement-metadata`, `get-direct-sign-status`, `create-selfserve-policy`, `list-selfserve-policies`, `update-selfserve-policy`, `delete-selfserve-policy`, `get-managed-services`, `update-organization-profile`.

| id | doc slug | area |
| --- | --- | --- |
| `get-customer-consent` | get-confirmation-of-customer-consent | customers |
| `get-agreement-metadata` | get-customer-agreement-metadata | customers |
| `get-direct-sign-status` | get-direct-sign-status-of-customer-agreement | customers |
| `create-selfserve-policy` | create-a-self-serve-policy | security |
| `list-selfserve-policies` | get-a-list-of-self-serve-policies | security |
| `update-selfserve-policy` | update-a-self-serve-policy | security |
| `delete-selfserve-policy` | delete-a-self-serve-policy | security |
| `get-managed-services` | get-the-managed-services-for-a-customer-by-id | customers |
| `update-organization-profile` | update-an-organization-profile | profiles |

- [ ] **Step 1: Write the failing test**

Append to `test/customer-admin.test.ts`:

```ts
test("batch I: agreements, self-serve policies and managed services are addressable", () => {
  for (const id of [
    "get-customer-consent", "get-agreement-metadata", "get-direct-sign-status",
    "create-selfserve-policy", "list-selfserve-policies", "update-selfserve-policy",
    "delete-selfserve-policy", "get-managed-services", "update-organization-profile",
  ]) {
    expect(byId.has(id), id).toBe(true);
  }
});

test("the self-serve policy CRUD is complete on one route", () => {
  const methods = ["create-selfserve-policy", "list-selfserve-policies", "update-selfserve-policy", "delete-selfserve-policy"]
    .map((id) => scenario(id).method);
  expect(methods).toEqual(["POST", "GET", "PUT", "DELETE"]);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/customer-admin.test.ts`
Expected: FAIL — `get-customer-consent` not found.

- [ ] **Step 3: Author the nine scenarios**

Facts that must land in `gotchas`:

- `get-customer-consent` hits the same `/agreements` route as the existing `get-agreements`. Say so, and say which one to reach for: `get-agreements` filters by `agreementType`, this reads confirmation of consent.
- `get-direct-sign-status` answers "did the customer sign the MCA directly with Microsoft" — a different question from partner-attested consent, and the one that decides whether the partner has to collect an attestation at all.
- The self-serve policy set governs what a customer may buy for themselves in the Microsoft admin center; note that `entity_id` scopes the list.
- `update-organization-profile` is a PUT on the PARTNER's own profile, not a customer's — the pack already has `get-organization-profile`; cross-link them.

- [ ] **Step 4: Run the batch test**

Run: `npx vitest run test/customer-admin.test.ts`
Expected: PASS.

- [ ] **Step 5: Ratchet up**

`test/pack-ratchet.test.ts`: `toBe(164)` and `toBe(163)`.

- [ ] **Step 6: Verify and commit**

```bash
npm run check-pack && npm run lint && npm test
git add data/scenarios.json test/pack-ratchet.test.ts test/customer-admin.test.ts
git commit -m "feat(pack): add agreement, self-serve policy and managed-service scenarios"
```

---

### Task 4: Batch J — device and configuration-policy completion (8 scenarios, ratchet 164/163 → 172/171)

The pack can upload a device batch and read policies, but cannot read the devices in a batch, delete one, apply a policy to devices, or poll the upload it just started. This batch closes that.

**Files:**
- Modify: `data/scenarios.json`
- Modify: `test/pack-ratchet.test.ts:41-42`
- Modify: `test/customer-admin.test.ts`

**Interfaces:**
- Produces: `create-configuration-policy`, `get-configuration-policy`, `update-configuration-policy`, `delete-configuration-policy`, `get-batch-devices`, `delete-device`, `update-device-policy`, `get-device-batch-status`.

| id | doc slug | area |
| --- | --- | --- |
| `create-configuration-policy` | create-a-new-configuration-policy-for-the-specified-customer | devices |
| `get-configuration-policy` | retrieve-a-customer-s-configuration-policy | devices |
| `update-configuration-policy` | update-a-configuration-policy-for-the-specified-customer | devices |
| `delete-configuration-policy` | delete-a-configuration-policy-for-the-specified-customer | devices |
| `get-batch-devices` | get-a-list-of-devices-for-the-specified-batch-and-customer | devices |
| `delete-device` | delete-a-device-for-the-specified-customer | devices |
| `update-device-policy` | update-a-list-of-devices-with-a-policy | devices |
| `get-device-batch-status` | get-the-status-of-a-device-batch-upload | devices |

- [ ] **Step 1: Write the failing test**

Append to `test/customer-admin.test.ts`:

```ts
test("batch J: the device and policy lifecycle is complete", () => {
  for (const id of [
    "create-configuration-policy", "get-configuration-policy", "update-configuration-policy",
    "delete-configuration-policy", "get-batch-devices", "delete-device",
    "update-device-policy", "get-device-batch-status",
  ]) {
    expect(byId.has(id), id).toBe(true);
  }
});

test("a device batch upload is asynchronous and says how to poll it", () => {
  expect(scenario("create-device-batch").gotchas.join(" ")).toContain("get-device-batch-status");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/customer-admin.test.ts`
Expected: FAIL — `create-configuration-policy` not found.

- [ ] **Step 3: Author the eight scenarios and cross-link the existing one**

Append a gotcha to the existing `create-device-batch` entry: `"The upload is asynchronous - it returns a tracking id in the Location header; poll get-device-batch-status until it completes rather than assuming the devices exist."`

Facts that must land in `gotchas` on the new entries:

- `get-device-batch-status` is what turns the async upload into a fact; without it a caller cannot know whether devices landed.
- `update-device-policy` applies a policy to devices in bulk and is a PATCH on `DevicePolicyUpdates`, not on the policy or the device.
- `delete-configuration-policy` fails while the policy is still assigned to devices — detach first with `update-device-policy`.

- [ ] **Step 4: Run the batch test**

Run: `npx vitest run test/customer-admin.test.ts`
Expected: PASS.

- [ ] **Step 5: Ratchet up**

`test/pack-ratchet.test.ts`: `toBe(172)` and `toBe(171)`.

- [ ] **Step 6: Verify and commit**

```bash
npm run check-pack && npm run lint && npm test
git add data/scenarios.json test/pack-ratchet.test.ts test/customer-admin.test.ts
git commit -m "feat(pack): complete the device batch and configuration policy scenarios"
```

---

### Task 5: Regenerate exports, update the README, release

**Files:**
- Modify: `README.md`, `generated/openapi.json`, `generated/partner-center.postman_collection.json`, `package.json`, `data/scenarios.json` (version stamp)

- [ ] **Step 1: Regenerate**

Run: `npm run build && npm run export`

- [ ] **Step 2: Update the README**

The Coverage section names the areas scenarios span; add customer administration explicitly (identity and profiles, users and roles, relationships, agreements, self-serve policies, device policies). Do not state a scenario count in prose — it goes stale.

- [ ] **Step 3: Full verification**

Run: `npm run build && npm run lint && npm test && npm run check-pack && npm run eval`
Expected: every command exits 0; read the `check-pack` output and confirm 0 field errors and no new skips.

- [ ] **Step 4: Commit and release**

```bash
git add -A
git commit -m "docs: cover customer administration and regenerate the exports"
npm version 0.14.0 --no-git-tag-version
git add -A && git commit -m "chore(release): 0.14.0"
git tag v0.14.0 && git push origin master && git push origin v0.14.0
```

The `Publish` workflow picks the tag up and ships npm + the MCP Registry. Confirm with `gh run list` and `npm view partner-center-mcp version`, then `gh release create v0.14.0`.

## Self-Review

**Coverage.** All 35 in-scope gaps are assigned: Batch G 10, H 8, I 9, J 8. The six excluded pages are listed with reasons in "Excluded, and why".

**No placeholders.** Every batch names its exact scenario ids, doc slugs, areas, ratchet numbers, and the specific facts that must appear in `gotchas`.

**Consistency.** Ratchet numbers chain 137 → 147 → 155 → 164 → 172, each batch's start matching the previous batch's end. The verified count trails the scenario count by one throughout, which is the single accepted skip (`get-invoice-billed-lineitems`).
