import { z } from "zod";
import type { Tool, ToolResult } from "../types.js";
import type { Knowledge } from "../knowledge/schema.js";
import { ok, toolError } from "../util/result.js";
import { envelope, OFFLINE } from "../util/schema.js";

export const explainLifecycle: Tool = {
  name: "pc_explain_lifecycle",
  title: "Explain the subscription lifecycle",
  description:
    "Return the subscription lifecycle state machine: which operations (increase-seats, decrease-seats, upgrade, cancel, renew-change, suspend, reactivate, migrate, transfer) are legal from which state, the field to read off the live subscription before attempting each one, the scenario that performs it, and the error codes a failed precondition returns. " +
    "Use this to answer \"what can I do to this subscription right now\" before reaching for an endpoint. For the endpoint itself use pc_get_scenario, for an ordered call sequence use pc_plan_subscription_change, and to decode a rejection use pc_lookup_error. " +
    "Read-only, offline, deterministic. Omit `operation` for the whole machine.",
  inputShape: {
    operation: z.string().optional().describe(
      "Narrow the answer to one operation: increase-seats, decrease-seats, upgrade, cancel, renew-change, suspend, reactivate, migrate, or transfer. Omit to get every operation.",
    ),
  },
  outputShape: envelope(z.object({
    states: z.array(z.string()).describe("Every state a subscription can be in."),
    operations: z.array(z.unknown()).describe(
      "The matching operations. Each has operation, title, fromStates, toState, scenarioId, guard ({ field, condition } or null), errorCodes and notes.",
    ),
  })),
  annotations: OFFLINE,
  run(args, ctx): ToolResult {
    const { states, operations } = (ctx.knowledge as Knowledge).lifecycle;
    if (args.operation === undefined) return ok({ states, operations });
    const match = operations.filter((o) => o.operation === args.operation);
    if (match.length === 0) {
      return toolError(
        `Unknown lifecycle operation "${args.operation}". Known: ${operations.map((o) => o.operation).join(", ")}.`,
      );
    }
    return ok({ states, operations: match });
  },
};
