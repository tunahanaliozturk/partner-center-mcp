import { z } from "zod";
import type { Tool } from "../types.js";
import { ok, notFound } from "../util/result.js";
import type { Knowledge } from "../knowledge/schema.js";

export const getEnums: Tool = {
  name: "pc_get_enums",
  description: "Look up Partner Center enum values (billingCycle, termDuration, targetView, segment, transitionType, subscriptionStatus, qualification, agreementType, billingType, provisioningStatus). Omit name to list all.",
  inputShape: { name: z.string().optional() },
  run(args, ctx) {
    const k = ctx.knowledge as Knowledge;
    if (!args.name) {
      return ok(Object.entries(k.enums).map(([name, e]) => ({ name, description: e.description, count: e.values.length })));
    }
    const key = Object.keys(k.enums).find((n) => n.toLowerCase() === String(args.name).toLowerCase());
    if (!key) return notFound(`No enum named "${args.name}".`, Object.keys(k.enums));
    return ok({ name: key, ...k.enums[key] });
  },
};
