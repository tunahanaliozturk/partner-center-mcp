import { z } from "zod";
import type { Tool } from "../types.js";
import type { Knowledge } from "../knowledge/schema.js";
import { ok, notFound, toolError } from "../util/result.js";

export const lookupError: Tool = {
  name: "pc_lookup_error",
  description: "Look up a Partner Center REST error by error code or HTTP status: meaning, causes, remediation.",
  inputShape: { code: z.string().optional(), httpStatus: z.number().int().optional() },
  run(args, ctx) {
    const errors = (ctx.knowledge as Knowledge).errors;
    if (args.code) {
      const hit = errors.find((e) => e.errorCode === args.code);
      return hit ? ok(hit) : notFound(`No error with code "${args.code}".`, errors.map((e) => e.errorCode));
    }
    if (args.httpStatus !== undefined) {
      const hits = errors.filter((e) => e.httpStatus === args.httpStatus);
      return hits.length ? ok(hits) : notFound(`No errors for HTTP ${args.httpStatus}.`, [...new Set(errors.map((e) => String(e.httpStatus)))]);
    }
    return toolError("Provide either code or httpStatus.");
  },
};
