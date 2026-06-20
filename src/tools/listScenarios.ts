import { z } from "zod";
import type { Tool } from "../types.js";
import { AREAS, type Knowledge } from "../knowledge/schema.js";
import { ok } from "../util/result.js";

export const listScenarios: Tool = {
  name: "pc_list_scenarios",
  description: "List supported Partner Center REST scenarios, optionally filtered by area.",
  inputShape: { area: z.enum(AREAS).optional() },
  run(args, ctx) {
    const k = ctx.knowledge as Knowledge;
    const scenarios = args.area ? k.scenarios.filter((s) => s.area === args.area) : k.scenarios;
    return ok(scenarios.map((s) => ({ id: s.id, title: s.title, area: s.area, method: s.method, path: s.path, authType: s.authType, docUrl: s.docUrl })));
  },
};
