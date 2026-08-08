import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { Tool } from "../types.js";
import { ok, notFound } from "../util/result.js";
import { envelope, OFFLINE } from "../util/schema.js";
import type { Knowledge } from "../knowledge/schema.js";
import { baseUrlFor } from "../knowledge/apis.js";
import { findScenario } from "../knowledge/lookup.js";

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
      const first = arr[0];
      if (!first) return; // unreachable: the guard above guarantees a first element
      cur = first;
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
  title: "Build a ready-to-send request",
  description:
    "Assemble one Partner Center REST request as structured data: the resolved URL with your params substituted into the path placeholders, concrete headers (Bearer plus a freshly generated MS-RequestId on writes), and a request-body skeleton derived from the operation's documented fields. " +
    "Use this when you want an object to send from your own client. For a language-specific code snippet use pc_generate_call instead, and to lint a request you already wrote use pc_validate_request. " +
    "Read-only and offline: the request is constructed and handed back, never sent, and the Authorization header is a `<access-token>` placeholder — no credentials are read or required. " +
    "Not idempotent in one respect: a random MS-RequestId is minted on each call for write operations, so reuse the returned value across retries rather than calling again. " +
    "Unsupplied placeholders are reported in `missingParams` rather than failing, and an unknown id returns ok:false with `suggestions`.",
  inputShape: {
    id: z.string().describe(
      "Exact scenario id in kebab-case, e.g. \"create-cart\". Case-sensitive; discover ids with pc_list_scenarios or any pc_plan_* tool.",
    ),
    params: z.record(z.string(), z.string()).optional().describe(
      "Values for the {placeholder} segments in the operation's path, as a flat string-to-string map — e.g. { \"customer-id\": \"c7f6e4b1-...\", \"subscription-id\": \"...\" }. " +
      "Keys are matched loosely, so \"customer-id\", \"customerId\", and \"customerid\" all work. Values are URL-encoded for you. " +
      "Omit it, or leave some out, to get the URL with those placeholders intact and the names listed in `missingParams`.",
    ),
  },
  outputShape: envelope(
    z.object({
      scenarioId: z.string().describe("The scenario this request was built for."),
      method: z.string().describe("HTTP verb to use."),
      url: z.string().describe("Fully resolved URL against the correct host, with supplied params substituted and URL-encoded."),
      headers: z.record(z.string(), z.string()).describe("Concrete headers to send. Authorization is a `<access-token>` placeholder for you to fill; MS-RequestId is a generated GUID you should reuse on retries."),
      body: z.union([z.record(z.string(), z.unknown()), z.null()]).describe("Request-body skeleton with type-appropriate empty defaults, or null for operations that take no body. Fill in real values before sending."),
      missingParams: z.array(z.string()).describe("Placeholder names still unfilled in `url`. Empty when everything was supplied."),
      authType: z.enum(["app-only", "app+user"]).describe("Token flavour this request requires."),
      docUrl: z.string().describe("Microsoft Learn page documenting this operation."),
      note: z.string().describe("Either confirmation that all placeholders are filled, or the list of params still needed."),
    }),
    { suggests: true },
  ),
  // A fresh MS-RequestId is minted per call for writes, so identical input does
  // not produce byte-identical output.
  annotations: { ...OFFLINE, idempotentHint: false },
  run(args, ctx) {
    const k = ctx.knowledge as Knowledge;
    const scenario = findScenario(k, args.id);
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
    const url = baseUrlFor(scenario.api) + filledPath;

    // Build concrete headers.
    const isWrite = ["POST", "PUT", "PATCH", "DELETE"].includes(scenario.method);
    const headers: Record<string, string> = {};
    const isGraph = scenario.api === "graph";
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
