import { z } from "zod";
import type { Tool } from "../types.js";
import type { Knowledge } from "../knowledge/schema.js";
import { ok, toolError } from "../util/result.js";
import { envelope, OFFLINE, PlanData } from "../util/schema.js";
import { baseUrlFor } from "../knowledge/apis.js";

interface Step { scenarioId: string; why: string }

function buildPlan(k: Knowledge, customerId: string | undefined, chain: Step[]) {
  const fill = (p: string) => (customerId ? p.replace("{customer-id}", customerId) : p);
  return chain.map((step, i) => {
    const s = k.scenarios.find((x) => x.id === step.scenarioId);
    if (!s) return null;
    // Resolve the FILLED path so `url` and `path` never disagree. The GDAP
    // and reconciliation-v2 chains are Graph, so a host-less path here would
    // be actively misleading.
    const path = fill(s.path);
    return {
      order: i + 1,
      scenarioId: s.id,
      title: s.title,
      method: s.method,
      path,
      url: baseUrlFor(s.api) + path,
      authType: s.authType,
      why: step.why,
      keyGotchas: s.gotchas.slice(0, 2),
      docUrl: s.docUrl,
    };
  }).filter(Boolean);
}

function makePlanTool(name: string, title: string, description: string, goal: string, chain: Step[], notes: string[]): Tool {
  return {
    name,
    title,
    description,
    inputShape: {
      customerId: z.string().optional().describe(
        "Optional Partner Center customer tenant id (GUID, e.g. \"c7f6e4b1-3a2d-4c5e-9f80-1b2c3d4e5f60\"). " +
        "When supplied it is substituted for the {customer-id} placeholder in every step's path and url, so the plan comes back ready to run. " +
        "Omit it to get the generic plan with placeholders left in place; the steps returned are identical either way.",
      ),
    },
    outputShape: envelope(PlanData),
    annotations: OFFLINE,
    run(args, ctx) {
      const k = ctx.knowledge as Knowledge;
      const steps = buildPlan(k, args.customerId, chain);
      if (steps.length === 0) return toolError(`Workflow scenarios for ${name} are missing from the knowledge pack.`);
      return ok({ goal, steps, notes });
    },
  };
}

// Every pc_plan_* tool behaves identically apart from the chain it walks, so the
// behavioural contract is stated once and appended to each description. Keeping
// it uniform is what lets an agent tell the plan tools apart on purpose alone.
const PLAN_BEHAVIOUR =
  " Planning only: nothing is executed, no Partner Center credentials are used, and no network call is made — it is a lookup over the bundled scenario pack. " +
  "Returns { goal, steps[] with order/scenarioId/method/path/url/authType/why/keyGotchas/docUrl, notes[] }. " +
  "Pass any step's scenarioId to pc_generate_call for runnable code, or pc_get_scenario for its full record.";

export const planTransfer = makePlanTool(
  "pc_plan_transfer",
  "Plan an NCE transfer",
  "Return the ordered New Commerce transfer (billing-ownership change) workflow: create the transfer, poll it, verify the moved subscriptions. " +
  "Use this when a customer is moving to a new partner of record. For a first-time customer link-up use pc_plan_csp_onboarding instead, and for buying new subscriptions use pc_plan_purchase." +
  PLAN_BEHAVIOUR,
  "Move a customer's New Commerce subscriptions to a new partner of record.",
  [
    { scenarioId: "create-transfer", why: "TARGET (new) partner creates the NCE transfer (transferType 3); customer must already have a reseller relationship." },
    { scenarioId: "get-transfer", why: "Poll status (Pending -> InProgress -> Complete); the source partner submits it on their side." },
    { scenarioId: "list-customer-subscriptions", why: "After completion, verify the transferred subscriptions under the new partner." },
  ],
  [
    "All steps use an App+User token (Admin agent) with audience https://api.partnercenter.microsoft.com.",
    "Only NewCommerce (transferType 3) is supported here; legacy subscriptions use a different flow.",
    "Use pc_lookup_error for 900400 / 900160 / 20002 on create.",
  ],
);

export const planGdapOnboarding = makePlanTool(
  "pc_plan_gdap_onboarding",
  "Plan GDAP onboarding",
  "Return the ordered GDAP onboarding workflow — create the relationship, lock it for customer approval, poll until active, then bind access assignments. " +
  "Use this when you need granular delegated admin rights over a customer tenant. Note these steps are Microsoft Graph calls, not Partner Center ones; " +
  "for the commercial relationship (invitation + agreement) use pc_plan_csp_onboarding, which is the usual prerequisite." +
  PLAN_BEHAVIOUR,
  "Establish granular delegated admin (GDAP) access to a customer tenant.",
  [
    { scenarioId: "create-gdap-relationship", why: "Create the relationship (Graph) with the needed Entra roles + duration; optionally target a specific customer." },
    { scenarioId: "create-gdap-relationship-request", why: "POST a request with action lockForApproval to finalize the relationship, then send the customer the admin.microsoft.com approval link." },
    { scenarioId: "get-gdap-relationship-by-id", why: "After the customer approves, poll until status is active." },
    { scenarioId: "create-gdap-access-assignment", why: "Bind a partner security group to the Entra roles in the customer tenant - this is what grants admin-on-behalf-of (AOBO)." },
    { scenarioId: "get-gdap-relationships", why: "Confirm the active relationship in the partner's GDAP list." },
  ],
  [
    "These are Microsoft Graph APIs (audience https://graph.microsoft.com, scope DelegatedAdminRelationship.ReadWrite.All) - NOT Partner Center.",
    "The approval link is https://admin.microsoft.com/AdminPortal/Home#/partners/invitation/granularAdminRelationships/{request-id}, using the id returned by the lockForApproval request.",
    "App-only access assignments require provisioning the service principal appId 2832473f-ec63-45fb-976f-5d45a7d4bb91 (Partner Customer Delegated Administration). Not available in China (21Vianet).",
  ],
);

export const planCspOnboarding = makePlanTool(
  "pc_plan_csp_onboarding",
  "Plan CSP customer onboarding",
  "Return the ordered CSP customer onboarding workflow: send the reseller relationship invitation, confirm the customer accepted it, record the Microsoft Customer Agreement, then read their subscriptions. " +
  "Use this to link an existing tenant to your CSP account before you can transact for them. For admin access on top of the relationship use pc_plan_gdap_onboarding; " +
  "to move an already-linked customer between partners use pc_plan_transfer." +
  PLAN_BEHAVIOUR,
  "Link an existing customer to your CSP account by establishing a reseller relationship and confirming the Microsoft Customer Agreement.",
  [
    { scenarioId: "get-reseller-relationship-url", why: "Generate the reseller relationship request (invitation) link and email it to the customer's global admin to approve." },
    { scenarioId: "get-customer-partners", why: "After the customer approves, confirm the reseller relationship exists (for two-tier, that BOTH you and your indirect provider are listed)." },
    { scenarioId: "create-agreement", why: "Record the customer's acceptance of the Microsoft Customer Agreement (MCA) - required before transacting." },
    { scenarioId: "list-customer-subscriptions", why: "Relationship + agreement in place: you can now read and manage the customer's subscriptions." },
  ],
  [
    "All steps use an App+User token (Admin agent) with audience https://api.partnercenter.microsoft.com.",
    "Customer approval of the relationship link happens out-of-band in their admin portal; poll get-customer-partners until your mpnId appears.",
    "Two-tier (indirect) partners: use get-indirect-resellers to find the reseller's mpnId for PartnerIdOnRecord when placing orders. For brand-new tenants, create-customer first (which can establish the relationship at the same time).",
  ],
);

export const planUserOnboarding = makePlanTool(
  "pc_plan_user_onboarding",
  "Plan user onboarding",
  "Return the ordered workflow for onboarding a user inside a customer tenant: pick available SKUs, create the account, assign licenses, grant directory roles, verify. " +
  "Use this for people-level provisioning. It is unrelated to buying subscriptions — for that use pc_plan_purchase — and the reverse direction is pc_plan_user_offboarding." +
  PLAN_BEHAVIOUR,
  "Onboard a new user in a customer tenant with the licenses (and roles) they need.",
  [
    { scenarioId: "get-subscribed-skus", why: "List the customer's available SKUs to pick the skuId(s) to assign (check available seats)." },
    { scenarioId: "create-user", why: "Create the user account in the customer tenant; set usageLocation so licenses can be assigned." },
    { scenarioId: "assign-licenses", why: "Assign the chosen skuId(s) to the new user. For scale, prefer assign-group-license and just add the user to a licensed group." },
    { scenarioId: "assign-user-role", why: "Optionally grant any directory role the user needs (e.g. Helpdesk Administrator)." },
    { scenarioId: "get-user-licenses", why: "Verify the licenses landed on the user." },
  ],
  [
    "All Partner Center steps use an App+User token with audience https://api.partnercenter.microsoft.com; assign-group-license is Microsoft Graph.",
    "Group-based licensing (assign-group-license + group membership) scales better than per-user assign-licenses for automated onboarding.",
    "A user needs a usageLocation before any license can be assigned.",
  ],
);

export const planUserOffboarding = makePlanTool(
  "pc_plan_user_offboarding",
  "Plan user offboarding",
  "Return the ordered workflow for removing a user from a customer tenant in the safe order: read their licenses, reclaim the seats, strip directory roles, then delete the account. " +
  "Use this to decommission a person without stranding licenses. The inverse is pc_plan_user_onboarding; cancelling the subscriptions themselves is a different concern." +
  PLAN_BEHAVIOUR,
  "Offboard a user from a customer tenant cleanly, reclaiming licenses first.",
  [
    { scenarioId: "get-user-licenses", why: "Read the user's current licenses so you know which skuIds to reclaim." },
    { scenarioId: "assign-licenses", why: "Remove the user's licenses via licensesToRemove (reclaim the seats)." },
    { scenarioId: "remove-user-role", why: "Strip any elevated directory roles before deletion." },
    { scenarioId: "delete-user", why: "Delete the account; it stays inactive for 30 days (restore-user can recover it within that window)." },
  ],
  [
    "All steps use an App+User token with audience https://api.partnercenter.microsoft.com; needs the User Administrator GDAP role.",
    "delete-user sets the account inactive for 30 days before it is purged; restore-user reverses it within that window.",
    "If licenses come from group membership (assign-group-license), reclaim them by removing the user from the group instead of licensesToRemove.",
  ],
);

export const planReconciliation = makePlanTool(
  "pc_plan_reconciliation",
  "Plan invoice reconciliation",
  "Return the ordered invoice reconciliation workflow for a billing period: locate the invoice, read its totals, pull billed and unbilled line items, download the statement. " +
  "Use this for billing and revenue reconciliation. Note the v1 line-item endpoints are being retired in favour of async Graph v2 exports — call pc_whats_new for the cutoff dates before building on them." +
  PLAN_BEHAVIOUR,
  "Reconcile a billing period: pull the invoice, its line items, and the statement.",
  [
    { scenarioId: "get-invoices", why: "Find the invoice for the billing period (filter by InvoiceDate)." },
    { scenarioId: "get-invoice-by-id", why: "Read totals and the per-provider links to line items." },
    { scenarioId: "get-invoice-billed-lineitems", why: "Pull billed reconciliation line items (paged)." },
    { scenarioId: "get-invoice-unbilled-lineitems", why: "Pull unbilled (current/previous period) line items for forecasting." },
    { scenarioId: "get-invoice-statement", why: "Download the invoice statement PDF." },
  ],
  [
    "All steps use an App+User token with audience https://api.partnercenter.microsoft.com.",
    "For new-commerce recon after the v1 cutoffs, prefer the async v2 Microsoft Graph exports (get-billed-reconciliation-v2 / get-unbilled-reconciliation-v2).",
    "See pc_whats_new for the v1->v2 reconciliation deadlines.",
  ],
);
