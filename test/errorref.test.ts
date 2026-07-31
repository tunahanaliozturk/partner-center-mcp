import { test, expect } from "vitest";
import { loadKnowledge } from "../src/knowledge/load.js";
import { lookupError } from "../src/tools/lookupError.js";
import { diagnose } from "../src/tools/diagnose.js";
import { getReference } from "../src/tools/getReference.js";
import type { ToolContext } from "../src/types.js";

const ctx: ToolContext = { knowledge: loadKnowledge("data"), docFetch: async () => ({ ok: true, excerpts: [] }) };

test("pc_lookup_error finds by error code and by http status", async () => {
  const byCode = await lookupError.run({ code: "900420" }, ctx);
  expect((byCode.data as any).remediation).toContain("api.partnercenter.microsoft.com");
  const byStatus = await lookupError.run({ httpStatus: 403 }, ctx);
  expect((byStatus.data as any[]).some((e: any) => e.httpStatus === 403)).toBe(true);
});

test("pc_lookup_error notFounds an unknown code", async () => {
  const r = await lookupError.run({ code: "111111" }, ctx);
  expect(r.ok).toBe(false);
});

test("pc_diagnose surfaces the retired-token error for a 401 symptom", async () => {
  const r = await diagnose.run({ symptom: "I get 401 900420 even though my token is new" }, ctx);
  expect((r.data as any).likely.some((e: any) => e.errorCode === "900420")).toBe(true);
});

test("pc_get_reference returns base urls", async () => {
  const r = await getReference.run({ topic: "base-urls" }, ctx);
  expect((r.data as any).commercial).toContain("api.partnercenter.microsoft.com");
});

test("the lifecycle rejections are decodable and point at the guard field", () => {
  const k = loadKnowledge("data");
  const byCode = new Map(k.errors.map((e) => [e.errorCode, e]));
  // Real Partner Center codes, taken from the error-codes page.
  for (const code of ["900117", "900213", "800019", "800027", "800061", "800063"]) {
    expect(byCode.has(code), code).toBe(true);
  }
  // The cancellation-window rejections must send the reader to the field that
  // decides the answer, not to a remembered number of days.
  for (const code of ["900117", "900213"]) {
    expect(byCode.get(code)!.remediation, code).toContain("cancellationAllowedUntilDate");
  }
  for (const e of k.errors) {
    for (const id of e.relatedScenarios ?? []) {
      expect(k.scenarios.some((s) => s.id === id), `${e.errorCode} -> ${id}`).toBe(true);
    }
  }
});
