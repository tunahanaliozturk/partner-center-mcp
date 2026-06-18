import { z } from "zod";
import type { Tool } from "../types.js";
import type { Knowledge } from "../knowledge/schema.js";
import { ok, notFound } from "../util/result.js";

export const getScenario: Tool = {
  name: "pc_get_scenario",
  description: "Get the full record for a Partner Center scenario: endpoint, auth, headers, ready REST examples, gotchas. Set enrich to attach live doc excerpts.",
  inputShape: { id: z.string(), enrich: z.boolean().optional() },
  async run(args, ctx) {
    const k = ctx.knowledge as Knowledge;
    const scenario = k.scenarios.find((s) => s.id === args.id);
    if (!scenario) {
      const suggestions = k.scenarios.map((s) => s.id).filter((id) => id.includes(args.id) || args.id.includes(id));
      return notFound(`No scenario with id "${args.id}".`, suggestions.length ? suggestions : k.scenarios.map((s) => s.id));
    }
    if (args.enrich) {
      const live = await ctx.docFetch(`${scenario.title} Partner Center`);
      return ok({ ...scenario, liveDocs: live.excerpts, liveNote: live.note });
    }
    return ok(scenario);
  },
};
