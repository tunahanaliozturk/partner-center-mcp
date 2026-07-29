import { z } from "zod";
import type { Tool } from "../types.js";
import { ok } from "../util/result.js";
import { envelope, OFFLINE } from "../util/schema.js";
import type { Knowledge } from "../knowledge/schema.js";

export const whatsNew: Tool = {
  name: "pc_whats_new",
  title: "List deprecations and deadlines",
  description:
    "List the Partner Center API deprecations and retirement deadlines — MFA enforcement, the graph.windows.net retirement, DAP to GDAP, v1 to v2 reconciliation, and the SDK/ADAL/AzureAD retirements — each with its date, impact, and the action to take, newest deadline first. " +
    "Use this before committing to an endpoint or auth mechanism, and to explain why something that used to work has stopped. " +
    "To check whether specific code is affected, run pc_check_auth on it. " +
    "Read-only, offline, deterministic — sourced from the bundled pack, so it is only as current as the pack's last refresh rather than a live feed.",
  inputShape: {
    status: z.enum(["upcoming", "in-progress", "enforced", "retired"]).optional().describe(
      "Filter by lifecycle stage. \"upcoming\": announced, deadline not reached. \"in-progress\": rolling out now. " +
      "\"enforced\": deadline passed and being applied. \"retired\": fully removed. Omit to get every item.",
    ),
  },
  outputShape: envelope(z.object({
    count: z.number().int().describe("Number of items returned after filtering."),
    items: z.array(z.object({
      title: z.string().describe("What is changing."),
      status: z.enum(["upcoming", "in-progress", "enforced", "retired"]).describe("Lifecycle stage of the change."),
      date: z.string().describe("Deadline or effective date as YYYY-MM-DD."),
      impact: z.string().describe("What breaks, and for whom."),
      action: z.string().describe("What to do about it."),
      docUrl: z.string().optional().describe("Microsoft Learn announcement or migration guide."),
    })).describe("Matching items sorted by date, newest deadline first."),
  })),
  annotations: OFFLINE,
  run(args, ctx) {
    const k = ctx.knowledge as Knowledge;
    let items = k.deprecations;
    if (args.status) items = items.filter((d) => d.status === args.status);
    // newest deadline first
    const sorted = [...items].sort((a, b) => (a.date < b.date ? 1 : -1));
    return ok({ count: sorted.length, items: sorted });
  },
};
