import { test, expect } from "vitest";
import { makeDocFetch } from "../src/docs/fetch.js";

test("docFetch returns excerpts from a successful response", async () => {
  const fakeFetch = (async () => ({
    ok: true,
    json: async () => ({ results: [{ title: "Auth", url: "https://learn.microsoft.com/x", excerpt: "use api.partnercenter" }] }),
  })) as unknown as typeof fetch;
  const docFetch = makeDocFetch({ fetchImpl: fakeFetch });
  const r = await docFetch("auth");
  expect(r.ok).toBe(true);
  expect(r.excerpts[0].url).toBe("https://learn.microsoft.com/x");
});

test("docFetch degrades gracefully on a thrown network error", async () => {
  const failing = (async () => { throw new Error("ENOTFOUND"); }) as unknown as typeof fetch;
  const docFetch = makeDocFetch({ fetchImpl: failing });
  const r = await docFetch("auth");
  expect(r.ok).toBe(false);
  expect(r.excerpts).toEqual([]);
  expect(r.note).toMatch(/unavailable/i);
});

test("docFetch degrades gracefully on a non-ok HTTP status", async () => {
  const notOk = (async () => ({ ok: false, status: 503, json: async () => ({}) })) as unknown as typeof fetch;
  const r = await makeDocFetch({ fetchImpl: notOk })("auth");
  expect(r.ok).toBe(false);
  expect(r.note).toMatch(/unavailable/i);
});
