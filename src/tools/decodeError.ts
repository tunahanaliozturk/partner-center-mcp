import { z } from "zod";
import type { Tool } from "../types.js";
import { ok } from "../util/result.js";
import type { Knowledge } from "../knowledge/schema.js";

const GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export const decodeError: Tool = {
  name: "pc_decode_error",
  description: "Paste a Partner Center error response (JSON or raw text). Decodes the error code with causes + remediation, links likely scenarios, and surfaces the correlation id for support.",
  inputShape: { error: z.string() },
  run(args, ctx) {
    const k = ctx.knowledge as Knowledge;
    const raw = args.error ?? "";

    // Pull out an error code, http status, and correlation id from JSON or text.
    let code: string | undefined;
    let httpStatus: number | undefined;
    try {
      const j = JSON.parse(raw) as Record<string, any>;
      code = String(j.errorCode ?? j.code ?? j.error?.code ?? "").trim() || undefined;
      const st = j.httpStatus ?? j.status ?? j.statusCode;
      if (st != null && !Number.isNaN(Number(st))) httpStatus = Number(st);
    } catch { /* not JSON */ }
    if (!code) code = raw.match(/\b(9\d{5}|\d{4,6})\b/)?.[1];
    if (httpStatus == null) httpStatus = raw.match(/\b(4\d{2}|5\d{2})\b/) ? Number(raw.match(/\b(4\d{2}|5\d{2})\b/)![1]) : undefined;
    const correlationId = raw.match(/correlation[^0-9a-f]{0,4}(" *: *"?)?\s*([0-9a-f-]{36})/i)?.[2]
      ?? raw.match(GUID)?.[0];

    const match = code ? k.errors.find((e) => e.errorCode === code) : undefined;
    const byStatus = !match && httpStatus ? k.errors.filter((e) => e.httpStatus === httpStatus) : [];

    const relatedScenarios = (match?.relatedScenarios ?? [])
      .map((id) => k.scenarios.find((s) => s.id === id))
      .filter(Boolean)
      .map((s) => ({ id: s!.id, title: s!.title, docUrl: s!.docUrl }));

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
