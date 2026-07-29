import { z } from "zod";
import type { Tool } from "../types.js";
import { ok } from "../util/result.js";
import { envelope, OFFLINE, ScenarioRef } from "../util/schema.js";
import { ErrorEntrySchema, type Knowledge } from "../knowledge/schema.js";

const GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export const decodeError: Tool = {
  name: "pc_decode_error",
  title: "Decode a raw error response",
  description:
    "Take a raw Partner Center error response and decode it: extract the error code, HTTP status, and MS-CorrelationId, then return the documented causes, remediation, likely scenarios, and the exact wording to quote in a support request. " +
    "This is the right first tool when something failed and you have the response in hand. Use pc_lookup_error instead when you have already isolated a clean code, " +
    "and pc_diagnose when you only have a prose description with no response body. " +
    "Read-only, offline, deterministic parsing — the input is never sent anywhere and no request is replayed. " +
    "Always returns ok:true: an unrecognised code still yields the parsed fields, status-based candidates, and a `note` on what to try next.",
  inputShape: {
    error: z.string().describe(
      "The error response pasted verbatim — a JSON body such as {\"code\":\"900400\",\"description\":\"...\"}, or unstructured log text containing the failure. " +
      "Include the response headers if you have them so the MS-CorrelationId can be recovered. Partial or malformed input is handled: whatever cannot be parsed is reported as null.",
    ),
  },
  outputShape: envelope(z.object({
    parsed: z.object({
      code: z.union([z.string(), z.null()]).describe("Error code recovered from the input, or null if none could be found."),
      httpStatus: z.union([z.number(), z.null()]).describe("HTTP status recovered from the input, or null."),
      correlationId: z.union([z.string(), z.null()]).describe("MS-CorrelationId GUID recovered from the input, or null. Microsoft support needs this to trace the request."),
    }).describe("What was extracted from the raw input."),
    match: z.union([ErrorEntrySchema, z.null()]).describe("The documented error entry for the extracted code, or null when the code is unknown or absent."),
    relatedScenarios: z.array(ScenarioRef).describe("Operations where this error commonly appears. Empty when there was no match."),
    candidatesByStatus: z.array(z.object({
      errorCode: z.string().describe("A code that shares the extracted HTTP status."),
      description: z.string().describe("What that code means."),
    })).describe("Fallback shortlist keyed off the HTTP status, populated only when no exact code match was found."),
    correlationGuidance: z.string().describe("Ready-to-use sentence for a support request, or instructions for capturing the correlation id when it was missing."),
    note: z.string().optional().describe("Present when decoding was incomplete, explaining what to do next."),
  })),
  annotations: OFFLINE,
  run(args, ctx) {
    const k = ctx.knowledge as Knowledge;
    const raw = args.error ?? "";

    // Pull out an error code, http status, and correlation id from JSON or text.
    let code: string | undefined;
    let httpStatus: number | undefined;
    try {
      // Arbitrary user-pasted JSON; the optional-chained reads below
      // (j.error?.code) do not typecheck under unknown.
      // biome-ignore lint/suspicious/noExplicitAny: see above
      const j = JSON.parse(raw) as Record<string, any>;
      code = String(j.errorCode ?? j.code ?? j.error?.code ?? "").trim() || undefined;
      const st = j.httpStatus ?? j.status ?? j.statusCode;
      if (st != null && !Number.isNaN(Number(st))) httpStatus = Number(st);
    } catch { /* not JSON */ }
    if (!code) code = raw.match(/\b(9\d{5}|\d{4,6})\b/)?.[1];
    if (httpStatus == null) {
      const statusMatch = raw.match(/\b(4\d{2}|5\d{2})\b/);
      if (statusMatch?.[1]) httpStatus = Number(statusMatch[1]);
    }
    const correlationId = raw.match(/correlation[^0-9a-f]{0,4}(" *: *"?)?\s*([0-9a-f-]{36})/i)?.[2]
      ?? raw.match(GUID)?.[0];

    const match = code ? k.errors.find((e) => e.errorCode === code) : undefined;
    const byStatus = !match && httpStatus ? k.errors.filter((e) => e.httpStatus === httpStatus) : [];

    const relatedScenarios = (match?.relatedScenarios ?? [])
      .map((id) => k.scenarios.find((s) => s.id === id))
      .filter((s): s is Knowledge["scenarios"][number] => s !== undefined)
      .map((s) => ({ id: s.id, title: s.title, docUrl: s.docUrl }));

    return ok({
      parsed: { code: code ?? null, httpStatus: httpStatus ?? null, correlationId: correlationId ?? null },
      match: match ?? null,
      relatedScenarios,
      candidatesByStatus: match ? [] : byStatus.map((e) => ({ errorCode: e.errorCode, description: e.description })),
      correlationGuidance: correlationId
        ? `Quote MS-CorrelationId ${correlationId} when opening a Partner Center support request.`
        : "No correlation id found; capture the MS-CorrelationId response header and include it in support requests.",
      note: match ? undefined : (code ? `Error code ${code} is not in the knowledge pack; try pc_search_docs.` : "Could not extract an error code; paste the full error JSON."),
    });
  },
};
