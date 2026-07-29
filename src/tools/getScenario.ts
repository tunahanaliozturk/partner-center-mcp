import { z } from "zod";
import type { Tool } from "../types.js";
import { type Knowledge, ScenarioSchema } from "../knowledge/schema.js";
import { ok, notFound } from "../util/result.js";
import { DocExcerpt, envelope, LIVE_DOCS, OFFLINE } from "../util/schema.js";

export const getScenario: Tool = {
  name: "pc_get_scenario",
  title: "Get one scenario in full",
  description:
    "Return the complete verified record for one Partner Center REST operation: method, path, auth type, required headers, request and response shapes, per-field notes, working curl/C#/TypeScript examples, gotchas, and the doc link. " +
    "Use this once you know the scenario id — get one from pc_list_scenarios, a pc_plan_* workflow, or pc_lookup_error. " +
    "For runnable code in a specific language prefer pc_generate_call; for a request body skeleton prefer pc_build_request. " +
    "Read-only. Offline and deterministic unless `enrich` is set, which adds a live Microsoft Learn fetch. " +
    "An unknown id returns ok:false with `suggestions` listing close or valid ids.",
  inputShape: {
    id: z.string().describe(
      "Exact scenario id in kebab-case, e.g. \"create-cart\", \"get-invoices\", \"list-customer-subscriptions\". " +
      "Case-sensitive; call pc_list_scenarios to discover valid ids. A near miss comes back as `suggestions` rather than a guess.",
    ),
    enrich: z.boolean().optional().describe(
      "Set true to also fetch live Microsoft Learn excerpts for this operation and attach them as `liveDocs`. " +
      "Defaults to false. Turning it on adds a network round-trip and makes the result non-deterministic; leave it off unless the bundled record is not enough.",
    ),
  },
  outputShape: envelope(
    ScenarioSchema.extend({
      liveDocs: z.array(DocExcerpt).optional().describe("Live documentation excerpts. Present only when `enrich` was true."),
      liveNote: z.string().optional().describe("Explains a degraded live fetch. Present only when `enrich` was true."),
    }),
    { suggests: true },
  ),
  // Offline by default; the `enrich` flag is the only path that touches the
  // network, and the annotation has to describe the worst case.
  annotations: { ...OFFLINE, idempotentHint: LIVE_DOCS.idempotentHint, openWorldHint: LIVE_DOCS.openWorldHint },
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
