import { test, expect } from "vitest";
import { loadKnowledge } from "../src/knowledge/load.js";

const k = loadKnowledge("data");

test("real pack validates and has the seed scenarios", () => {
  const ids = k.scenarios.map((s) => s.id);
  expect(ids).toContain("verify-mpn");
  expect(ids).toContain("assign-licenses");
  expect(ids).toContain("list-customer-subscriptions");
});

test("real pack carries the retired-token error and current auth resource", () => {
  expect(k.errors.find((e) => e.errorCode === "900420")).toBeTruthy();
  expect(k.auth.clouds.commercial.tokenResource).toBe("https://api.partnercenter.microsoft.com");
  expect(k.auth.patterns["app+user"].mfa.enforcementDate).toBe("2026-04-01");
});

test("every record has docUrl and scenarios have lastVerified", () => {
  for (const s of k.scenarios) { expect(s.docUrl).toMatch(/^https:\/\//); expect(s.lastVerified).toMatch(/^\d{4}-\d{2}-\d{2}$/); }
  for (const e of k.errors) expect(e.docUrl).toMatch(/^https:\/\//);
});
