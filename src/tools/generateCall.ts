import { z } from "zod";
import type { Tool } from "../types.js";
import type { Knowledge } from "../knowledge/schema.js";
import { ok, notFound } from "../util/result.js";

export const generateCall: Tool = {
  name: "pc_generate_call",
  description: "Generate a current Partner Center REST call for a scenario in the chosen language. Never emits the archived .NET SDK.",
  inputShape: {
    id: z.string(),
    language: z.enum(["curl", "csharp", "typescript", "powershell"]),
  },
  run(args, ctx) {
    const k = ctx.knowledge as Knowledge;
    const scenario = k.scenarios.find((s) => s.id === args.id);
    if (!scenario) return notFound(`No scenario with id "${args.id}".`, k.scenarios.map((s) => s.id));
    const lang = args.language;
    // powershell is derived from curl when no dedicated example exists.
    const code = lang === "powershell"
      ? `# PowerShell (Invoke-RestMethod)\nInvoke-RestMethod -Method ${scenario.method} -Uri "https://api.partnercenter.microsoft.com${scenario.path}" -Headers @{ Authorization = "Bearer $token" }`
      : scenario.examples[lang as "curl" | "csharp" | "typescript"];
    return ok({ language: lang, code, authType: scenario.authType, docUrl: scenario.docUrl });
  },
};
