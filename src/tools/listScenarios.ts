import { z } from "zod";
import type { Tool } from "../types.js";
import { AREAS, type Knowledge } from "../knowledge/schema.js";
import { ok } from "../util/result.js";
import { baseUrlFor } from "../knowledge/apis.js";

export const listScenarios: Tool = {
  name: "pc_list_scenarios",
  description: "List supported Partner Center REST scenarios, optionally filtered by area.",
  inputShape: { area: z.enum(AREAS).optional() },
  run(args, ctx) {
    const k = ctx.knowledge as Knowledge;
    const scenarios = args.area ? k.scenarios.filter((s) => s.area === args.area) : k.scenarios;
    // `path` is relative to the scenario's api base, so on its own it is
    // ambiguous: a Graph route and a Partner Center route look alike. `url`
    // resolves it so a consumer never has to guess the host.
    return ok(scenarios.map((s) => ({ id: s.id, title: s.title, area: s.area, method: s.method, path: s.path, url: baseUrlFor(s.api) + s.path, authType: s.authType, docUrl: s.docUrl })));
  },
};
