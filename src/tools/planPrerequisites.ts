import { z } from "zod";
import type { Tool, ToolResult } from "../types.js";
import type { Knowledge } from "../knowledge/schema.js";
import { ok, notFound } from "../util/result.js";
import { envelope, OFFLINE } from "../util/schema.js";
import { findScenario } from "../knowledge/lookup.js";
import { planPrerequisites } from "../knowledge/prerequisites.js";
import { baseUrlFor } from "../knowledge/apis.js";

export const planPrerequisitesTool: Tool = {
  name: "pc_plan_prerequisites",
  title: "Plan the calls that produce a scenario's parameters",
  description:
    "Given any scenario, return the ordered calls that produce the ids its path needs, plus the parameters you have to supply yourself. " +
    "Answers \"I want to call this, what do I need first\" for every operation in the pack, not just the ones with a hand-written workflow. " +
    "For a business sequence and its preconditions prefer the curated planners: pc_plan_purchase, pc_plan_subscription_change, pc_plan_order_lifecycle, pc_plan_transfer, pc_plan_csp_onboarding, pc_plan_gdap_onboarding, pc_plan_user_onboarding, pc_plan_user_offboarding, pc_plan_reconciliation. " +
    "This one only resolves parameters, which is why it works everywhere. " +
    "Planning only: nothing is executed, no credentials are used, no network call is made.",
  inputShape: {
    id: z.string().describe(
      "Scenario id you want to end up calling, e.g. \"cancel-subscription\" or \"get-batch-devices\". " +
      "Discover ids with pc_list_scenarios. An unknown id comes back as ok:false with suggestions.",
    ),
    customerId: z.string().optional().describe(
      "Optional customer tenant id (GUID). When supplied it is substituted for {customer-id} in every step, and the call that would have produced it is dropped from the plan.",
    ),
  },
  outputShape: envelope(z.object({
    target: z.object({
      scenarioId: z.string(),
      title: z.string(),
      method: z.string(),
      path: z.string(),
      url: z.string(),
    }).describe("The operation the plan leads to."),
    steps: z.array(z.object({
      order: z.number(),
      scenarioId: z.string(),
      title: z.string(),
      method: z.string(),
      path: z.string(),
      url: z.string(),
      provides: z.string().describe("The placeholder this call exists to obtain."),
      why: z.string(),
    })).describe("Calls to make first, in dependency order. Empty when the target needs nothing looked up."),
    callerSupplied: z.array(z.string()).describe(
      "Parameters you decide rather than look up: paging, filters, market, segment, dates.",
    ),
    unresolved: z.array(z.string()).describe(
      "Placeholders with no known producer. A gap in the pack's map rather than in the API; report them.",
    ),
    notes: z.array(z.string()),
  })),
  annotations: OFFLINE,
  run(args, ctx): ToolResult {
    const k = ctx.knowledge as Knowledge;
    const target = findScenario(k, args.id);
    if (!target) {
      const close = k.scenarios.map((s) => s.id).filter((id) => id.includes(args.id) || args.id.includes(id));
      return notFound(`No scenario with id "${args.id}".`, close.length ? close : k.scenarios.map((s) => s.id));
    }

    const plan = planPrerequisites(k, target);
    const fill = (p: string) => (args.customerId ? p.replace("{customer-id}", args.customerId) : p);

    // A supplied customer id makes the call that would have produced it pointless.
    const steps = plan.steps
      .filter((s) => !(args.customerId && s.provides === "customer-id"))
      .map((s, i) => ({
        ...s,
        order: i + 1,
        path: fill(s.path),
        url: baseUrlFor(k.scenarios.find((x) => x.id === s.scenarioId)?.api) + fill(s.path),
      }));

    const notes = [
      "Parameter resolution only: this says how to obtain the ids, not whether the operation is allowed. Check preconditions with pc_explain_lifecycle for subscription changes.",
      "Each step's response carries the id the next one needs; pc_get_scenario shows a real example response where the docs publish one.",
    ];
    if (plan.unresolved.length) {
      notes.push(`No producer is mapped for: ${plan.unresolved.join(", ")}. You will have to source those yourself.`);
    }

    return ok({
      target: {
        scenarioId: target.id,
        title: target.title,
        method: target.method,
        path: fill(target.path),
        url: baseUrlFor(target.api) + fill(target.path),
      },
      steps,
      callerSupplied: plan.callerSupplied,
      unresolved: plan.unresolved,
      notes,
    });
  },
};
