import { z } from "zod";
import type { ToolBehaviour } from "../types.js";

/**
 * Every tool answers with the same envelope: `ok`, plus either `data` or an
 * `error` string. Declaring it per tool — with the concrete `data` schema
 * spliced in — lets an MCP client validate structured output instead of
 * guessing at the JSON it gets back.
 *
 * `suggests` adds the `suggestions` array that the not-found path returns, so
 * only tools that can actually miss advertise it.
 */
export function envelope(data: z.ZodTypeAny, opts: { suggests?: boolean } = {}): z.ZodRawShape {
  return {
    ok: z.boolean().describe("True when the call succeeded and `data` is populated; false when `error` explains why not."),
    data: data.optional().describe("The result payload. Present only when `ok` is true."),
    error: z.string().optional().describe("Human-readable reason the call failed. Present only when `ok` is false."),
    ...(opts.suggests
      ? {
          suggestions: z.array(z.string()).optional()
            .describe("Valid values to retry with, returned alongside `error` when the requested identifier was not found."),
        }
      : {}),
  };
}

/** Offline lookup over the bundled knowledge pack: no network, fully deterministic. */
export const OFFLINE: ToolBehaviour = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

/** Reads live Microsoft Learn pages, so results can change between identical calls. */
export const LIVE_DOCS: ToolBehaviour = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};

/** A scenario reference thin enough to hand back as a cross-link. */
export const ScenarioRef = z.object({
  id: z.string().describe("Scenario id to pass to pc_get_scenario or pc_generate_call."),
  title: z.string().describe("Human-readable name of the operation."),
  docUrl: z.string().describe("Microsoft Learn page documenting this operation."),
});

/** One step of an ordered workflow plan, as returned by every pc_plan_* tool. */
export const PlanStep = z.object({
  order: z.number().int().describe("1-based position of this step in the workflow."),
  scenarioId: z.string().describe("Scenario id; pass to pc_generate_call to get ready-to-run code for this step."),
  title: z.string().describe("Human-readable name of the operation."),
  method: z.string().describe("HTTP verb (GET, POST, PUT, PATCH, DELETE)."),
  path: z.string().describe("API-relative path, with {customer-id} substituted when customerId was supplied."),
  url: z.string().describe("Fully resolved URL: the path joined to the correct host, which is Microsoft Graph for GDAP and reconciliation-v2 steps."),
  authType: z.enum(["app-only", "app+user"]).describe("Token flavour this step requires."),
  why: z.string().describe("Why this step exists and what it contributes to the workflow."),
  keyGotchas: z.array(z.string()).describe("Up to two of the most consequential pitfalls for this step."),
  docUrl: z.string().describe("Microsoft Learn page documenting this operation."),
});

/** The payload shared by every pc_plan_* tool. */
export const PlanData = z.object({
  goal: z.string().describe("What the whole workflow accomplishes."),
  steps: z.array(PlanStep).describe("The steps in the order they must be performed."),
  notes: z.array(z.string()).describe("Cross-cutting constraints that apply to the workflow as a whole: token audience, cloud availability, related tools."),
});

/** A doc excerpt returned by the live Microsoft Learn fetcher. */
export const DocExcerpt = z.object({
  title: z.string().describe("Title of the source documentation page."),
  url: z.string().describe("Canonical Microsoft Learn URL for the excerpt."),
  text: z.string().describe("The excerpted passage."),
});
