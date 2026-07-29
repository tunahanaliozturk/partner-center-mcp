import { z } from "zod";
import type { Tool } from "../types.js";
import { ErrorEntrySchema, type Knowledge } from "../knowledge/schema.js";
import { ok, notFound, toolError } from "../util/result.js";
import { envelope, OFFLINE, ScenarioRef } from "../util/schema.js";

export const lookupError: Tool = {
  name: "pc_lookup_error",
  title: "Look up an error code",
  description:
    "Look up a Partner Center error by its numeric code or HTTP status and return what it means, its known causes, the remediation, the doc link, and the scenarios where it usually appears. " +
    "Use this when you already have a clean code. If you have a raw error response, pc_decode_error is better — it extracts the code and correlation id for you first. " +
    "For a symptom described in prose with no code at all, use pc_diagnose. " +
    "Read-only, offline, deterministic. Exactly one of `code` or `httpStatus` must be supplied; supplying neither returns ok:false. " +
    "An unknown code returns ok:false with `suggestions` listing every code in the pack.",
  inputShape: {
    code: z.string().optional().describe(
      "Partner Center error code as a string, e.g. \"900400\" or \"20002\". Matched exactly, so strip surrounding text first. " +
      "Takes precedence when both this and `httpStatus` are given. Supply this or `httpStatus`.",
    ),
    httpStatus: z.number().int().optional().describe(
      "HTTP status code to list errors for, e.g. 400 or 403. Use this when you have no Partner Center code — it returns every documented error with that status, so expect several. " +
      "Ignored when `code` is supplied. Supply this or `code`.",
    ),
  },
  outputShape: envelope(
    z.union([
      ErrorEntrySchema.extend({
        relatedScenarios: z.array(ScenarioRef).describe("Scenarios where this error commonly surfaces, resolved from ids to { id, title, docUrl }."),
      }).describe("The single matching error, returned for a `code` lookup."),
      z.array(ErrorEntrySchema).describe("Every documented error with the requested status, returned for an `httpStatus` lookup."),
    ]),
    { suggests: true },
  ),
  annotations: OFFLINE,
  run(args, ctx) {
    const k = ctx.knowledge as Knowledge;
    const errors = k.errors;
    const withScenarios = (e: typeof errors[number]) => ({
      ...e,
      relatedScenarios: (e.relatedScenarios ?? [])
        .map((id) => k.scenarios.find((s) => s.id === id))
        .filter((s): s is Knowledge["scenarios"][number] => s !== undefined)
        .map((s) => ({ id: s.id, title: s.title, docUrl: s.docUrl })),
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
