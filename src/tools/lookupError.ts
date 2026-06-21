import { z } from "zod";
import type { Tool } from "../types.js";
import type { Knowledge } from "../knowledge/schema.js";
import { ok, notFound, toolError } from "../util/result.js";

export const lookupError: Tool = {
  name: "pc_lookup_error",
  description: "Look up a Partner Center REST error by error code or HTTP status: meaning, causes, remediation.",
  inputShape: { code: z.string().optional(), httpStatus: z.number().int().optional() },
  run(args, ctx) {
    const k = ctx.knowledge as Knowledge;
    const errors = k.errors;
    const withScenarios = (e: typeof errors[number]) => ({
      ...e,
      relatedScenarios: (e.relatedScenarios ?? [])
        .map((id) => k.scenarios.find((s) => s.id === id))
        .filter(Boolean)
        .map((s) => ({ id: s!.id, title: s!.title, docUrl: s!.docUrl })),
    });
    if (args.code) {
      const hit = errors.find((e) => e.errorCode === args.code);
      return hit ? ok(withScenarios(hit)) : notFound(`No error with code "${args.code}".`, errors.map((e) => e.errorCode));
    }
    if (args.httpStatus !== undefined) {
      const hits = errors.filter((e) => e.httpStatus === args.httpStatus);
      return hits.length ? ok(hits) : notFound(`No errors for HTTP ${args.httpStatus}.`, [...new Set(errors.map((e) => String(e.httpStatus)))]);
    }
    return toolError("Provide either code or httpStatus.");
  },
};
