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

/**
 * Same plan shape as makePlanTool, but the chain is selected by an `operation`
 * argument instead of being fixed. The subscription lifecycle is one tool with
 * nine branches rather than nine tools: an agent choosing between them is
 * choosing an operation, and that choice reads better as an argument than as a
 * tool name.
 */
function makeOperationPlanTool(
  name: string,
  title: string,
  description: string,
  chains: Record<string, { goal: string; steps: Step[]; notes: string[] }>,
): Tool {
  const operations = Object.keys(chains);
  return {
    name,
    title,
    description,
    inputShape: {
      operation: z.enum(operations as [string, ...string[]]).describe(
        `Which lifecycle change to plan. One of: ${operations.join(", ")}. Required — there is no default. ` +
        "Use pc_explain_lifecycle first if you do not yet know which operation the subscription's current state allows.",
      ),
      customerId: z.string().optional().describe(
        "Optional Partner Center customer tenant id (GUID, e.g. \"c7f6e4b1-3a2d-4c5e-9f80-1b2c3d4e5f60\"). " +
        "When supplied it is substituted for the {customer-id} placeholder in every step's path and url, so the plan comes back ready to run. " +
        "Omit it to get the generic plan with placeholders left in place; the steps returned are identical either way.",
      ),
    },
    outputShape: envelope(PlanData),
    annotations: OFFLINE,
    run(args, ctx) {
      const chain = chains[args.operation as string];
      if (!chain) return toolError(`Unknown operation "${args.operation}". Known: ${operations.join(", ")}.`);
      const k = ctx.knowledge as Knowledge;
      const steps = buildPlan(k, args.customerId, chain.steps);
      if (steps.length === 0) {
        return toolError(`Workflow scenarios for ${name}/${args.operation} are missing from the knowledge pack.`);
      }
      return ok({ goal: chain.goal, steps, notes: chain.notes });
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

// Read-then-write is the shape of almost every lifecycle change: the guard the
// pack cares about (cancellationAllowedUntilDate, autoRenewEnabled,
// suspensionReasons) lives on the subscription, so the plan starts by reading
// it rather than assuming the caller already has it.
const READ_SUBSCRIPTION: Step = {
  scenarioId: "get-subscription-by-id",
  why: "Read the current subscription: it carries the guard field this operation is judged against, and the full resource you PATCH back.",
};

export const planSubscriptionChange = makeOperationPlanTool(
  "pc_plan_subscription_change",
  "Plan a subscription lifecycle change",
  "Return the ordered call sequence for one subscription lifecycle change: increase-seats, decrease-seats, upgrade, cancel, renew-change, suspend, reactivate, migrate or transfer. " +
  "Each plan reads the subscription first, states the precondition that decides whether the change is legal, performs it, and confirms it. " +
  "Use pc_explain_lifecycle to find out WHICH operation is available; use this to find out HOW to run it. For a new purchase use pc_plan_purchase, and for the order side use pc_plan_order_lifecycle." +
  PLAN_BEHAVIOUR,
  {
    "increase-seats": {
      goal: "Add seats to an active subscription.",
      steps: [
        READ_SUBSCRIPTION,
        { scenarioId: "change-subscription-quantity", why: "PATCH the full resource with the new TOTAL seat count; increases are prorated and need no window." },
        { scenarioId: "get-subscription-provisioning-status", why: "Confirm the change provisioned before treating the extra seats as assignable." },
      ],
      notes: [
        "Increases are unconditional; it is decreases that are bounded by cancellationAllowedUntilDate.",
        "quantity is the new total, not a delta.",
        "The PATCH carries the full resource - omit autoRenewEnabled and it silently resets to false.",
        "Rejected while the subscription is suspended (error 2001).",
      ],
    },
    "decrease-seats": {
      goal: "Remove seats from an active subscription.",
      steps: [
        READ_SUBSCRIPTION,
        { scenarioId: "change-subscription-quantity", why: "PATCH the lower TOTAL seat count - only accepted while the window below is still open." },
        { scenarioId: "get-subscription-provisioning-status", why: "Confirm the reduction provisioned." },
      ],
      notes: [
        "GUARD: cancellationAllowedUntilDate must still be in the future. Read it off the subscription in step 1 - do not assume a window length.",
        "Past that date the request fails with 800090; schedule the smaller seat count for the next term with operation renew-change instead.",
        "Seat reduction is not supported at all while the subscription is suspended.",
      ],
    },
    upgrade: {
      goal: "Move a subscription to a different offer (New Commerce transition).",
      steps: [
        { scenarioId: "get-subscription-transition-eligibilities", why: "GUARD: the target must appear here. Take its catalogItemId as toCatalogItemId." },
        { scenarioId: "create-subscription-transition", why: "Perform the transition; transitionType decides whether assigned user licenses move too." },
        { scenarioId: "get-subscription-transitions", why: "Poll the transition history - a transition is asynchronous." },
      ],
      notes: [
        "GUARD: transitionEligibilities must list the target; an empty list means there is no path from this offer.",
        "eligibilityType=immediate transitions now, eligibilityType=scheduled targets the next term.",
        "Legacy (non-NCE) subscriptions upgrade through the /upgrades route instead - see get-subscription-upgrades.",
      ],
    },
    cancel: {
      goal: "Cancel a subscription and stop billing it.",
      steps: [
        READ_SUBSCRIPTION,
        { scenarioId: "cancel-subscription", why: "PATCH the full resource with status \"deleted\"." },
        { scenarioId: "get-subscription-provisioning-status", why: "Confirm the cancellation provisioned." },
      ],
      notes: [
        "GUARD: cancellationAllowedUntilDate must still be in the future, and refundOptions describes what comes back. Both are read in step 1.",
        "Past that date the request fails with 900117 / 900213. The only lever left is turning autorenew off (operation renew-change, or update-subscription-autorenew): the subscription then expires at term end, still billed for the current term.",
        "Suspending is not cancelling - it stops service without stopping billing.",
        "Software subscriptions and perpetual software cancel at the ORDER instead: cancel-software-purchase.",
      ],
    },
    "renew-change": {
      goal: "Change what the subscription renews into at the next term.",
      steps: [
        READ_SUBSCRIPTION,
        { scenarioId: "get-subscription-transition-eligibilities", why: "For end-of-sale-with-conversions offers, get the valid next-term target (eligibilityType=scheduled)." },
        { scenarioId: "create-scheduled-changes", why: "PATCH the full resource carrying scheduledActions (or scheduledNextTermInstructions)." },
      ],
      notes: [
        "GUARD: autoRenewEnabled must be true, or the scheduled instructions are never applied.",
        "Term duration, billing cycle and seat count cannot change mid-term; this is how they change at the next term.",
        "Send scheduledActions OR scheduledNextTermInstructions, never both - only scheduledActions is honoured if both are present.",
        "For legacy subscriptions the billing cycle changes on the ORDER (update-order), not here (error 2054).",
      ],
    },
    suspend: {
      goal: "Suspend a subscription's service.",
      steps: [
        READ_SUBSCRIPTION,
        { scenarioId: "suspend-subscription", why: "PATCH the full resource with status \"suspended\"." },
      ],
      notes: [
        "Suspension stops service but NOT billing. If the goal is to stop paying, cancel inside the cancellation window instead.",
        "Seat count cannot be changed while suspended.",
        "Reverse it with operation reactivate.",
      ],
    },
    reactivate: {
      goal: "Bring a suspended subscription back into service.",
      steps: [
        READ_SUBSCRIPTION,
        { scenarioId: "reactivate-subscription", why: "PATCH the full resource with status \"active\"." },
      ],
      notes: [
        "GUARD: read suspensionReasons first. A subscription suspended by Microsoft (non-payment, fraud) stays suspended until that reason clears, whatever the partner PATCHes.",
        "Only valid from suspended - a cancelled (deleted) subscription has to be repurchased.",
      ],
    },
    migrate: {
      goal: "Migrate a legacy subscription to New Commerce.",
      steps: [
        { scenarioId: "validate-migration", why: "GUARD: returns isEligible plus the exact reasons a migration would be rejected." },
        { scenarioId: "migrate-to-new-commerce", why: "Start the migration; omitted properties carry the legacy values forward." },
        { scenarioId: "get-migration", why: "Poll the migration - it is asynchronous." },
        { scenarioId: "get-migration-events", why: "Read the step-by-step trail, the only place a failure reason survives." },
      ],
      notes: [
        "GUARD: validate-migration must report isEligible true.",
        "Base subscriptions migrate with all active add-ons as a bundle; one ineligible add-on fails the whole bundle.",
        "To run it later instead of now use create-migration-schedule, which can also fire at the legacy term's renewal.",
      ],
    },
    transfer: {
      goal: "Move billing ownership of a customer's subscriptions to another partner.",
      steps: [
        { scenarioId: "create-transfer", why: "The TARGET (new) partner creates the transfer; transferType 3 for New Commerce." },
        { scenarioId: "get-transfer", why: "Poll status - the source partner accepts or rejects on their side." },
        { scenarioId: "list-customer-subscriptions", why: "After completion, verify the subscriptions now sit under the new partner." },
      ],
      notes: [
        "GUARD: relationshipToPartner - the customer must already have a reseller relationship with the target partner, or creation fails with 900400.",
        "The source partner responds with accept-transfer or reject-transfer; the creating partner can back out with update-transfer (status \"Cancel\") or withdraw-transfer while it is pending.",
        "Legacy subscriptions go through create-legacy-transfer instead.",
        "A pending transfer blocks other lifecycle writes on the affected subscriptions - check list-customer-transfers when a write is rejected for no obvious reason.",
      ],
    },
  },
);

export const planOrderLifecycle = makePlanTool(
  "pc_plan_order_lifecycle",
  "Plan an order from cart to provisioned subscriptions",
  "Return the ordered workflow that takes a purchase from cart to confirmed, provisioned subscriptions: build the cart, check out, poll the order's provisioning status, resolve the subscriptions it created, and confirm each one provisioned. " +
  "Use this when a purchase has to be verified rather than assumed. For choosing WHAT to buy use pc_plan_purchase; for changing a subscription afterwards use pc_plan_subscription_change." +
  PLAN_BEHAVIOUR,
  "Take a purchase from cart to subscriptions you can prove exist.",
  [
    { scenarioId: "create-cart", why: "Build the cart; it validates and prices the purchase before it is placed." },
    { scenarioId: "checkout-cart", why: "Place the order. A 2xx here means ACCEPTED, not provisioned." },
    { scenarioId: "get-order-provisioning-status", why: "Poll until every line item reports success - the step that is usually skipped." },
    { scenarioId: "get-subscriptions-by-order", why: "Resolve the subscriptions the order created." },
    { scenarioId: "get-subscription-provisioning-status", why: "Confirm each subscription provisioned before treating its licenses as assignable." },
  ],
  [
    "All steps use an App+User token with audience https://api.partnercenter.microsoft.com.",
    "Provisioning is reported per ORDER LINE ITEM, so a partially provisioned order is normal - check every line item.",
    "To include add-ons in the initial purchase use create-cart-with-addons; to add one later use purchase-addon, which PATCHes the base subscription's order.",
    "Cancelling: software subscriptions and perpetual software cancel at the order (cancel-software-purchase); seat-based online services cancel at the subscription (pc_plan_subscription_change operation cancel).",
    "Products that need activation expose a link per line item - see get-order-activation-link.",
  ],
);
