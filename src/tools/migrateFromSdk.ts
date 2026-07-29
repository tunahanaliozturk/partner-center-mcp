import { z } from "zod";
import type { Tool } from "../types.js";
import { type Knowledge, ScenarioSchema } from "../knowledge/schema.js";
import { ok } from "../util/result.js";
import { envelope, OFFLINE } from "../util/schema.js";

export const migrateFromSdk: Tool = {
  name: "pc_migrate_from_sdk",
  title: "Map archived SDK calls to REST",
  description:
    "Find the archived Partner Center .NET SDK calls in a snippet and map each one to the current REST scenario that replaces it, with migration notes. " +
    "Use this to port code off the SDK, which was archived in June 2023. Run pc_check_auth alongside it to catch retired auth in the same snippet, " +
    "then pass each returned scenario id to pc_generate_call to emit the replacement code. " +
    "Read-only, offline, deterministic pattern matching: the snippet is not executed and nothing is rewritten in place — you get the mapping, not modified code. " +
    "Always returns ok:true; when nothing matched, `matches` is empty and `unmatched` is true.",
  inputShape: {
    code: z.string().describe(
      "C# code that calls the archived SDK, pasted as-is — e.g. a block using IAggregatePartner or PartnerService.Instance. " +
      "A fragment is enough; matching is on the SDK call chain and is case-insensitive. Multiple calls in one snippet each get their own entry.",
    ),
  },
  outputShape: envelope(z.object({
    matches: z.array(z.object({
      sdkPattern: z.string().describe("The archived SDK call chain that was recognised."),
      notes: z.string().describe("What changes in the move to REST: renamed fields, behavioural differences, extra steps."),
      scenario: ScenarioSchema.describe("The full REST scenario that replaces this SDK call."),
    })).describe("One entry per recognised SDK call. Empty when the snippet used no known SDK pattern."),
    unmatched: z.boolean().describe("True when nothing was recognised — either the code does not use the archived SDK, or the call is not in the mapping table. Try pc_search_docs in that case."),
  })),
  annotations: OFFLINE,
  run(args, ctx) {
    const k = ctx.knowledge as Knowledge;
    const matches = k.sdkMap
      .filter((m) => {
        const tail = m.sdkPattern.split(".").slice(-2).join(".").replace(/\{[^}]+\}/g, "");
        const needle = tail.replace(/\(\)$/, "").replace(/[()]/g, "");
        const safeNeedle = needle.replace(/\./g, "\\.");
        return new RegExp(safeNeedle, "i").test(args.code);
      })
      .map((m) => ({ sdkPattern: m.sdkPattern, notes: m.notes, scenario: k.scenarios.find((s) => s.id === m.restScenarioId) }))
      .filter((m) => m.scenario);
    return ok({ matches, unmatched: matches.length === 0 });
  },
};
