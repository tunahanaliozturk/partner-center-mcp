import { z } from "zod";
import type { Tool } from "../types.js";
import type { Knowledge, Scenario } from "../knowledge/schema.js";
import { ok } from "../util/result.js";

interface Finding { severity: "error" | "warning" | "info"; message: string; fix?: string }

// Does an input path match a scenario path template (segments, placeholders)?
function pathMatches(scenarioPath: string, inputPath: string): boolean {
  const sp = scenarioPath.split("?")[0].split("/").filter(Boolean);
  const ip = inputPath.split("?")[0].split("/").filter(Boolean);
  if (sp.length !== ip.length) return false;
  return sp.every((seg, i) => (seg.startsWith("{") && seg.endsWith("}")) || seg.toLowerCase() === ip[i].toLowerCase());
}

function normalizePath(url: string): string {
  let p = url.trim();
  p = p.replace(/^https?:\/\/[^/]+/i, ""); // strip scheme+host
  if (!p.startsWith("/")) p = "/" + p;
  return p;
}

export const validateRequest: Tool = {
  name: "pc_validate_request",
  description: "Lint a Partner Center REST call (method, URL, headers, auth) against the known scenarios: wrong method/path, missing Authorization or MS-RequestId, retired audience, and unsupported app-only usage.",
  inputShape: {
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]),
    url: z.string(),
    authType: z.enum(["app-only", "app+user"]).optional(),
    cloud: z.enum(["commercial", "china-21vianet", "us-gov"]).optional(),
    headers: z.record(z.string()).optional(),
  },
  run(args, ctx) {
    const k = ctx.knowledge as Knowledge;
    const findings: Finding[] = [];
    const path = normalizePath(args.url);
    const headers: Record<string, string> = args.headers ?? {};
    const headerNames = Object.keys(headers).map((h) => h.toLowerCase());
    const hasHeader = (name: string) => headerNames.includes(name.toLowerCase());

    // Path / method matching.
    const samePath = k.scenarios.filter((s) => pathMatches(s.path, path));
    const matched: Scenario | undefined = samePath.find((s) => s.method === args.method);

    if (samePath.length === 0) {
      findings.push({ severity: "info", message: `No known scenario matches the path ${path}. It may still be valid; check pc_list_scenarios.` });
    } else if (!matched) {
      const methods = [...new Set(samePath.map((s) => s.method))].join(", ");
      findings.push({ severity: "error", message: `Path matches a known scenario but the method ${args.method} is wrong; expected ${methods}.`, fix: `Use ${methods} for ${samePath[0].path}.` });
    }

    // Auth / header checks against the matched scenario.
    if (matched) {
      if (args.authType === "app-only" && matched.authType === "app+user") {
        findings.push({ severity: "error", message: `Scenario "${matched.id}" does not support app-only authentication.`, fix: "Use an App+User (secure application model) token." });
      }
      if (!hasHeader("authorization")) {
        findings.push({ severity: "error", message: "Missing Authorization header.", fix: "Add Authorization: Bearer <token> with audience https://api.partnercenter.microsoft.com." });
      }
      if (["POST", "PUT", "PATCH", "DELETE"].includes(matched.method) && !hasHeader("ms-requestid")) {
        findings.push({ severity: "warning", message: "Write operation without MS-RequestId.", fix: "Add a unique MS-RequestId and reuse it on retries for idempotency." });
      }
    } else if (!hasHeader("authorization")) {
      findings.push({ severity: "error", message: "Missing Authorization header.", fix: "Add Authorization: Bearer <token> with audience https://api.partnercenter.microsoft.com." });
    }

    // Retired audience check across header values.
    for (const [name, value] of Object.entries(headers)) {
      if (/graph\.windows\.net/i.test(value)) {
        findings.push({ severity: "error", message: `Header ${name} references the retired graph.windows.net audience (causes 401 / 900420).`, fix: "Request the token with resource https://api.partnercenter.microsoft.com." });
      }
    }

    // Cloud host hint.
    if (args.cloud && args.cloud !== "commercial") {
      const base = k.reference.baseUrls[args.cloud];
      if (base) findings.push({ severity: "info", message: `For the ${args.cloud} cloud, use base URL ${base} and the matching login authority (${k.auth.clouds[args.cloud]?.authority}).` });
    }

    const hasError = findings.some((f) => f.severity === "error");
    return ok({
      ok: !hasError,
      matched: matched ? { id: matched.id, title: matched.title, method: matched.method, path: matched.path, authType: matched.authType, docUrl: matched.docUrl } : null,
      findings,
    });
  },
};
