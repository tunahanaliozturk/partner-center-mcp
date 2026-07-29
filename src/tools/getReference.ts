import { z } from "zod";
import type { Tool, ToolResult } from "../types.js";
import type { Knowledge } from "../knowledge/schema.js";
import { ok } from "../util/result.js";
import { envelope, OFFLINE } from "../util/schema.js";

export const getReference: Tool = {
  name: "pc_get_reference",
  title: "Get API-wide reference facts",
  description:
    "Return the cross-cutting facts that apply to every Partner Center call rather than to one operation: base URLs, required headers, API versioning, the sandbox account, rate limits, and national cloud differences. " +
    "Use this for questions about the API as a whole. For a specific endpoint use pc_get_scenario, and for authentication specifics use pc_auth_guidance. " +
    "Read-only, offline, deterministic. `topic` is required and the payload shape differs per topic.",
  inputShape: {
    topic: z.enum(["base-urls", "headers", "versioning", "sandbox", "rate-limits", "national-clouds"]).describe(
      "Which reference topic to return. " +
      "\"base-urls\": host per API surface. " +
      "\"headers\": the headers every request should carry and why. " +
      "\"versioning\": how API versions are selected. " +
      "\"sandbox\": integration sandbox account rules. " +
      "\"rate-limits\": throttling behaviour and how to back off. " +
      "\"national-clouds\": what differs in the sovereign clouds. Required — there is no default.",
    ),
  },
  outputShape: envelope(z.unknown().describe(
    "Shape depends on `topic`. \"base-urls\" returns a map of api id to host; \"headers\" returns [{ name, purpose }]; " +
    "the remaining topics return a single-key object holding a prose explanation, e.g. { rateLimits: \"...\" }.",
  )),
  annotations: OFFLINE,
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
