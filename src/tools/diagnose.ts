import { z } from "zod";
import type { Tool } from "../types.js";
import type { Knowledge } from "../knowledge/schema.js";
import { ok } from "../util/result.js";

export const diagnose: Tool = {
  name: "pc_diagnose",
  description: "Diagnose a Partner Center symptom in natural language: surface likely error(s) and a fix path.",
  inputShape: { symptom: z.string() },
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
