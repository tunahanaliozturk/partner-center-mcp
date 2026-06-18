import { z } from "zod";
import type { Tool } from "../types.js";
import { ok } from "../util/result.js";

export const searchDocs: Tool = {
  name: "pc_search_docs",
  description: "Search current Microsoft Learn Partner Center developer docs for depth beyond the curated pack.",
  inputShape: { query: z.string(), topK: z.number().int().positive().max(10).optional() },
  async run(args, ctx) {
    const live = await ctx.docFetch(`Partner Center ${args.query}`);
    const excerpts = args.topK ? live.excerpts.slice(0, args.topK) : live.excerpts;
    return ok({ excerpts, note: live.note });
  },
};
