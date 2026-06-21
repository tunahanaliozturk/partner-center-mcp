import { z } from "zod";
import type { Tool } from "../types.js";
import { ok } from "../util/result.js";
import type { Knowledge } from "../knowledge/schema.js";

export const whatsNew: Tool = {
  name: "pc_whats_new",
  description: "Partner Center API deprecations and deadlines (MFA enforcement, graph.windows.net retirement, DAP->GDAP, v1->v2 reconciliation, SDK/ADAL/AzureAD retirements) with dates and the action to take.",
  inputShape: { status: z.enum(["upcoming", "in-progress", "enforced", "retired"]).optional() },
  run(args, ctx) {
    const k = ctx.knowledge as Knowledge;
    let items = k.deprecations;
    if (args.status) items = items.filter((d) => d.status === args.status);
    // newest deadline first
    const sorted = [...items].sort((a, b) => (a.date < b.date ? 1 : -1));
    return ok({ count: sorted.length, items: sorted });
  },
};
