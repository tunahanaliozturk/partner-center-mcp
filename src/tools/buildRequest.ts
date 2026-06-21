import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { Tool } from "../types.js";
import { ok, notFound } from "../util/result.js";
import type { Knowledge, Scenario } from "../knowledge/schema.js";

const COMMERCIAL = "https://api.partnercenter.microsoft.com";

function defaultFor(type: string, note?: string): unknown {
  const lit = note?.match(/'([^']+)'/);
  if (lit) return lit[1];
  const t = type.toLowerCase();
  if (t.includes("bool")) return false;
  if (t.includes("int") || t.includes("number") || t.includes("decimal")) return 0;
  if (t.endsWith("[]") || t.includes("array")) return [];
  if (t.includes("object") || /^[A-Z]/.test(type)) return {};
  return "";
}

// Set a dotted/array field path (e.g. "a.b", "lineItems[].id") on a skeleton object.
function setField(root: Record<string, unknown>, name: string, value: unknown): void {
  const parts = name.split(".");
  let cur: Record<string, unknown> = root;
  parts.forEach((raw, i) => {
    const isLast = i === parts.length - 1;
    const isArr = raw.endsWith("[]");
    const key = isArr ? raw.slice(0, -2) : raw;
    if (isArr) {
      if (!Array.isArray(cur[key]) || (cur[key] as unknown[]).length === 0) cur[key] = [{}];
      const arr = cur[key] as Record<string, unknown>[];
      if (isLast) return; // array of bare values; leave as [{}]
      cur = arr[0];
    } else if (isLast) {
      cur[key] = value;
    } else {
      if (typeof cur[key] !== "object" || cur[key] === null) cur[key] = {};
      cur = cur[key] as Record<string, unknown>;
    }
  });
}

export const buildRequest: Tool = {
  name: "pc_build_request",
  description: "Build a ready-to-send Partner Center REST request for a scenario: substitutes path placeholders from params, fills headers (Bearer + generated MS-RequestId/MS-CorrelationId on writes), and produces a request-body skeleton from the scenario's required fields.",
  inputShape: {
    id: z.string(),
    params: z.record(z.string()).optional(),
  },
  run(args, ctx) {
    const k = ctx.knowledge as Knowledge;
    const scenario = k.scenarios.find((s) => s.id === args.id) as Scenario | undefined;
    if (!scenario) return notFound(`No scenario with id "${args.id}".`, k.scenarios.map((s) => s.id));

    const params = args.params ?? {};
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const paramByNorm = new Map(Object.entries(params).map(([key, v]) => [norm(key), v]));

    // Fill {placeholders} in the path.
    const missingParams: string[] = [];
    const filledPath = scenario.path.replace(/\{([^}]+)\}/g, (_m, token: string) => {
      const v = params[token] ?? paramByNorm.get(norm(token));
      if (v == null) { missingParams.push(token); return `{${token}}`; }
      return encodeURIComponent(v);
    });
    const url = filledPath.startsWith("http") ? filledPath : COMMERCIAL + filledPath;

    // Build concrete headers.
    const isWrite = ["POST", "PUT", "PATCH", "DELETE"].includes(scenario.method);
    const headers: Record<string, string> = {};
    const isGraph = url.startsWith("https://graph.microsoft.com");
    for (const h of scenario.headers) {
      const n = h.name.toLowerCase();
      if (n === "authorization") headers[h.name] = isGraph ? "Bearer <graph-access-token>" : "Bearer <access-token>";
      else if (n === "content-type") headers[h.name] = "application/json";
      else if (n === "accept") headers[h.name] = "application/json";
      else if (n === "ms-requestid" || n === "ms-correlationid") headers[h.name] = randomUUID();
      else headers[h.name] = `<${h.name}>`;
    }
    if (isWrite && !Object.keys(headers).some((h) => h.toLowerCase() === "ms-requestid")) {
      headers["MS-RequestId"] = randomUUID();
    }

    // Body skeleton from requestFields.
    let body: Record<string, unknown> | null = null;
    if (scenario.requestFields?.length) {
      body = {};
      for (const f of scenario.requestFields) {
        if (f.name.startsWith("(")) continue; // e.g. "(full resource)" / "(array)"
        setField(body, f.name, defaultFor(f.type, f.note));
      }
      if (Object.keys(body).length === 0) body = null;
    }

    return ok({
      scenarioId: scenario.id,
      method: scenario.method,
      url,
      headers,
      body,
      missingParams,
      authType: scenario.authType,
      docUrl: scenario.docUrl,
      note: missingParams.length ? `Provide params for: ${missingParams.join(", ")}` : "All path placeholders filled.",
    });
  },
};
