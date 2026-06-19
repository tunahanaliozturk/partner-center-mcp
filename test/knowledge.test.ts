import { test, expect } from "vitest";
import { loadKnowledge } from "../src/knowledge/load.js";
import { ok, notFound } from "../src/util/result.js";

test("loadKnowledge validates and returns the pack", () => {
  const k = loadKnowledge("test/fixtures");
  expect(k.scenarios[0].id).toBe("verify-mpn");
  expect(k.errors[0].errorCode).toBe("900420");
  expect(k.auth.patterns["app+user"].mfa.enforcementDate).toBe("2026-04-01");
  expect(k.reference.baseUrls.commercial).toContain("api.partnercenter.microsoft.com");
});

test("loadKnowledge throws a clear error on a malformed file", () => {
  expect(() => loadKnowledge("test/fixtures-bad")).toThrow(/scenarios\.json/);
});

test("result helpers shape ToolResult", () => {
  expect(ok({ a: 1 })).toEqual({ ok: true, data: { a: 1 } });
  expect(notFound("nope", ["x"])).toEqual({ ok: false, error: "nope", suggestions: ["x"] });
});
