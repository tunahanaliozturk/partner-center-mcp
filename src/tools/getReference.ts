import { z } from "zod";
import type { Tool, ToolResult } from "../types.js";
import type { Knowledge } from "../knowledge/schema.js";
import { ok } from "../util/result.js";

export const getReference: Tool = {
  name: "pc_get_reference",
  description: "Partner Center REST reference: base URLs, required headers, versioning, sandbox, rate limits.",
  inputShape: { topic: z.enum(["base-urls", "headers", "versioning", "sandbox", "rate-limits", "national-clouds"]) },
  run(args, ctx): ToolResult {
    const ref = (ctx.knowledge as Knowledge).reference;
    switch (args.topic) {
      case "base-urls": return ok(ref.baseUrls);
      case "headers": return ok(ref.headers);
      case "versioning": return ok({ versioning: ref.versioning });
      case "sandbox": return ok({ sandbox: ref.sandbox });
      case "rate-limits": return ok({ rateLimits: ref.rateLimits });
      case "national-clouds": return ok({ nationalClouds: ref.nationalClouds });
      default: return ok({});
    }
  },
};
