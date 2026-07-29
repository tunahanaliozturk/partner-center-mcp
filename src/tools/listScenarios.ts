import { z } from "zod";
import type { Tool } from "../types.js";
import { AREAS, type Knowledge } from "../knowledge/schema.js";
import { ok } from "../util/result.js";
import { envelope, OFFLINE } from "../util/schema.js";
import { baseUrlFor } from "../knowledge/apis.js";

export const listScenarios: Tool = {
  name: "pc_list_scenarios",
  title: "List available scenarios",
  description:
    "List every Partner Center REST operation this server knows about, as a compact index of id, title, area, method, resolved url, and auth type. " +
    "Start here to discover what is available and to find the scenario id that the other tools take; then call pc_get_scenario for the full record or pc_generate_call for code. " +
    "This is a catalogue of documented operations, not a query against a live tenant — it returns no customer data. " +
    "Read-only, offline, deterministic. Filtering by an area with no entries returns an empty list rather than an error.",
  inputShape: {
    area: z.enum(AREAS).optional().describe(
      `Restrict the list to one functional area. One of: ${AREAS.join(", ")}. Omit to list every scenario across all areas.`,
    ),
  },
  outputShape: envelope(z.array(z.object({
    id: z.string().describe("Scenario id to pass to pc_get_scenario, pc_generate_call, or pc_build_request."),
    title: z.string().describe("Human-readable name of the operation."),
    area: z.enum(AREAS).describe("Functional area the operation belongs to."),
    method: z.string().describe("HTTP verb."),
    path: z.string().describe("API-relative path with {placeholder} segments; ambiguous on its own, so prefer `url`."),
    url: z.string().describe("Fully resolved URL including the correct host, which is Microsoft Graph for GDAP and reconciliation-v2 operations."),
    authType: z.enum(["app-only", "app+user"]).describe("Token flavour the operation requires."),
    docUrl: z.string().describe("Microsoft Learn page documenting this operation."),
  })).describe("One entry per matching scenario, in pack order.")),
  annotations: OFFLINE,
  run(args, ctx) {
    const k = ctx.knowledge as Knowledge;
    const scenarios = args.area ? k.scenarios.filter((s) => s.area === args.area) : k.scenarios;
    // `path` is relative to the scenario's api base, so on its own it is
    // ambiguous: a Graph route and a Partner Center route look alike. `url`
    // resolves it so a consumer never has to guess the host.
    return ok(scenarios.map((s) => ({ id: s.id, title: s.title, area: s.area, method: s.method, path: s.path, url: baseUrlFor(s.api) + s.path, authType: s.authType, docUrl: s.docUrl })));
  },
};
