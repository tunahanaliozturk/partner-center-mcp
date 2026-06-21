import { z } from "zod";
import type { Tool } from "../types.js";
import type { Knowledge } from "../knowledge/schema.js";
import { ok, toolError } from "../util/result.js";

interface Step { scenarioId: string; why: string }

function buildPlan(k: Knowledge, customerId: string | undefined, chain: Step[]) {
  const fill = (p: string) => (customerId ? p.replace("{customer-id}", customerId) : p);
  return chain.map((step, i) => {
    const s = k.scenarios.find((x) => x.id === step.scenarioId);
    if (!s) return null;
    return {
      order: i + 1,
      scenarioId: s.id,
      title: s.title,
      method: s.method,
      path: fill(s.path),
      authType: s.authType,
      why: step.why,
      keyGotchas: s.gotchas.slice(0, 2),
      docUrl: s.docUrl,
    };
  }).filter(Boolean);
}

function makePlanTool(name: string, description: string, goal: string, chain: Step[], notes: string[]): Tool {
  return {
    name,
    description,
    inputShape: { customerId: z.string().optional() },
    run(args, ctx) {
      const k = ctx.knowledge as Knowledge;
      const steps = buildPlan(k, args.customerId, chain);
      if (steps.length === 0) return toolError(`Workflow scenarios for ${name} are missing from the knowledge pack.`);
      return ok({ goal, steps, notes });
    },
  };
}

export const planTransfer = makePlanTool(
  "pc_plan_transfer",
  "The ordered New Commerce transfer (billing-ownership) workflow with the exact REST scenario for each step.",
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
  "The ordered GDAP onboarding workflow (create -> approve -> verify) across Microsoft Graph.",
  "Establish granular delegated admin (GDAP) access to a customer tenant.",
  [
    { scenarioId: "create-gdap-relationship", why: "Create the relationship (Graph) with the needed Entra roles + duration; optionally target a specific customer." },
    { scenarioId: "get-gdap-relationship-by-id", why: "After locking for approval and the customer approving the admin.microsoft.com link, poll until status is active." },
    { scenarioId: "get-gdap-relationships", why: "Confirm the active relationship in the partner's GDAP list." },
  ],
  [
    "These are Microsoft Graph APIs (audience https://graph.microsoft.com, scope DelegatedAdminRelationship.ReadWrite.All) - NOT Partner Center.",
    "Steps not represented as separate scenarios: POST a delegatedAdminRelationshipRequest (action lockForApproval), send the customer the admin.microsoft.com approval link, then create accessAssignments (security groups -> roles) for admin-on-behalf-of.",
    "Not available in China (21Vianet).",
  ],
);

export const planReconciliation = makePlanTool(
  "pc_plan_reconciliation",
  "The ordered invoice reconciliation workflow (invoice -> billed/unbilled line items -> statement).",
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
