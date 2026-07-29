import { z } from "zod";
import type { Tool } from "../types.js";
import { ErrorEntrySchema, type Knowledge } from "../knowledge/schema.js";
import { ok } from "../util/result.js";
import { envelope, OFFLINE } from "../util/schema.js";

export const diagnose: Tool = {
  name: "pc_diagnose",
  title: "Diagnose a symptom",
  description:
    "Match a Partner Center problem described in plain language against the documented errors and return the likely candidates plus an ordered fix path. " +
    "Use this when you have no error body and no code — just a description of what is going wrong. " +
    "If you have the raw response use pc_decode_error, and if you have a clean code use pc_lookup_error; both are far more precise than this. " +
    "Read-only, offline, deterministic keyword matching, so the candidate list is a heuristic shortlist and can be empty or noisy. " +
    "Always returns ok:true; `nextSteps` is a fixed checklist and is returned even when nothing matched.",
  inputShape: {
    symptom: z.string().describe(
      "What is going wrong, in plain language — e.g. \"checkout returns 400 for NCE carts in Germany\" or \"token works for Graph but Partner Center says unauthorized\". " +
      "Matching is keyword-based and case-insensitive, so include concrete nouns: the operation, the HTTP status, error text. Any codes or statuses in the text are matched directly.",
    ),
  },
  outputShape: envelope(z.object({
    likely: z.array(ErrorEntrySchema).describe("Documented errors whose codes, statuses, or causes overlap the symptom text. A heuristic shortlist, not a ranked diagnosis; may be empty."),
    nextSteps: z.array(z.string()).describe("Fixed triage checklist naming the tool to use at each step. Returned regardless of whether anything matched."),
  })),
  annotations: OFFLINE,
  run(args, ctx) {
    const k = ctx.knowledge as Knowledge;
    const text = args.symptom.toLowerCase();
    const likely = k.errors.filter((e) =>
      text.includes(e.errorCode) || text.includes(String(e.httpStatus)) ||
      e.causes.some((c) => c.toLowerCase().split(" ").some((w) => w.length > 4 && text.includes(w))),
    );
    const nextSteps = [
      "Confirm your token audience is https://api.partnercenter.microsoft.com (pc_check_auth).",
      "Check the operation's required authType with pc_get_scenario.",
      "If still stuck, search current docs with pc_search_docs.",
    ];
    return ok({ likely, nextSteps });
  },
};
