import { test, expect } from "vitest";
import { loadKnowledge } from "../src/knowledge/load.js";

const k = loadKnowledge("data");

// The literal path prefix before the first placeholder or query string.
const pathPrefix = (path: string) => path.split(/[?{]/)[0];

test("scenario ids are unique", () => {
  const ids = k.scenarios.map((s) => s.id);
  expect(new Set(ids).size).toBe(ids.length);
});

test("every scenario path is under /v1, /v3, or an explicit https URL (e.g. Graph)", () => {
  for (const s of k.scenarios) expect(s.path, s.id).toMatch(/^(\/v[13]\/|https:\/\/)/);
});

test("every scenario's curl example targets its API host and its own path", () => {
  for (const s of k.scenarios) {
    const host = s.path.startsWith("http") ? new URL(s.path).host : "api.partnercenter.microsoft.com";
    expect(s.examples.curl, s.id).toContain(host);
    expect(s.examples.curl, s.id).toContain(pathPrefix(s.path));
  }
});

test("no scenario example leaks the retired graph.windows.net audience", () => {
  for (const s of k.scenarios) {
    for (const code of Object.values(s.examples)) {
      expect(code, s.id).not.toMatch(/graph\.windows\.net/);
    }
  }
});

test("every scenario example is non-empty for all three languages", () => {
  for (const s of k.scenarios) {
    expect(s.examples.curl.length, s.id).toBeGreaterThan(0);
    expect(s.examples.csharp.length, s.id).toBeGreaterThan(0);
    expect(s.examples.typescript.length, s.id).toBeGreaterThan(0);
  }
});

test("every SDK mapping points at a real scenario id", () => {
  const ids = new Set(k.scenarios.map((s) => s.id));
  for (const m of k.sdkMap) {
    expect(ids.has(m.restScenarioId), `${m.sdkPattern} -> ${m.restScenarioId}`).toBe(true);
  }
});

test("every error has a non-empty remediation, at least one cause, and a real HTTP status", () => {
  for (const e of k.errors) {
    expect(e.remediation.trim().length, e.errorCode).toBeGreaterThan(0);
    expect(e.causes.length, e.errorCode).toBeGreaterThan(0);
    expect(e.httpStatus, e.errorCode).toBeGreaterThanOrEqual(100);
    expect(e.httpStatus, e.errorCode).toBeLessThan(600);
  }
});

test("reference base URLs and auth clouds stay in sync", () => {
  for (const cloud of Object.keys(k.auth.clouds)) {
    expect(k.reference.baseUrls[cloud], cloud).toBeTruthy();
  }
  expect(k.auth.deprecations.length).toBeGreaterThan(0);
});
