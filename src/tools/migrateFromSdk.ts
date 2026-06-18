import { z } from "zod";
import type { Tool } from "../types.js";
import type { Knowledge } from "../knowledge/schema.js";
import { ok } from "../util/result.js";

export const migrateFromSdk: Tool = {
  name: "pc_migrate_from_sdk",
  description: "Translate archived Partner Center .NET SDK code into the equivalent current REST scenario(s).",
  inputShape: { code: z.string() },
  run(args, ctx) {
    const k = ctx.knowledge as Knowledge;
    const matches = k.sdkMap
      .filter((m) => {
        const tail = m.sdkPattern.split(".").slice(-2).join(".").replace(/\{[^}]+\}/g, "");
        const needle = tail.replace(/\(\)$/, "").replace(/[()]/g, "");
        return new RegExp(needle, "i").test(args.code);
      })
      .map((m) => ({ sdkPattern: m.sdkPattern, notes: m.notes, scenario: k.scenarios.find((s) => s.id === m.restScenarioId) }))
      .filter((m) => m.scenario);
    return ok({ matches, unmatched: matches.length === 0 });
  },
};
