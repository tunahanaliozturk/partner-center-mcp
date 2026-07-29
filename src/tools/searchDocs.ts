import { z } from "zod";
import type { Tool } from "../types.js";
import { ok } from "../util/result.js";
import { DocExcerpt, envelope, LIVE_DOCS } from "../util/schema.js";

export const searchDocs: Tool = {
  name: "pc_search_docs",
  title: "Search live Partner Center docs",
  description:
    "Search the live Microsoft Learn Partner Center developer documentation and return matching excerpts. " +
    "Use this as the fallback when the curated pack has no answer: try pc_list_scenarios / pc_get_scenario / pc_lookup_error first, since those are verified and offline. " +
    "Reaches the public internet, so results are not deterministic and the call can be slow or come back empty with a `note` when the fetch fails. " +
    "Read-only and safe to retry; no Partner Center credentials are involved. Returns { excerpts[] with title/url/text, note }.",
  inputShape: {
    query: z.string().describe(
      "What to look up, in plain language or as keywords — e.g. \"cart line item promotion eligibility\" or \"MS-CorrelationId header\". " +
      "\"Partner Center\" is prepended automatically, so do not repeat it. An error code or endpoint path works as a query too.",
    ),
    topK: z.number().int().positive().max(10).optional().describe(
      "Maximum number of excerpts to return, 1-10. Omit to get everything the fetcher found (usually a handful). Lower it to keep the response small.",
    ),
  },
  outputShape: envelope(z.object({
    excerpts: z.array(DocExcerpt).describe("Matching documentation passages, most relevant first. Empty when nothing matched or the live fetch failed."),
    note: z.string().optional().describe("Explains a degraded result, e.g. that the live fetch timed out and the curated pack should be used instead."),
  })),
  annotations: LIVE_DOCS,
  async run(args, ctx) {
    const live = await ctx.docFetch(`Partner Center ${args.query}`);
    const excerpts = args.topK ? live.excerpts.slice(0, args.topK) : live.excerpts;
    return ok({ excerpts, note: live.note });
  },
};
