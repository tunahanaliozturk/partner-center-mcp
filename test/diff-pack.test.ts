import { test, expect } from "vitest";
import { loadKnowledge } from "../src/knowledge/load.js";
import { diffPack } from "../src/tools/diffPack.js";
import { fingerprintScenario, diffFingerprints } from "../src/knowledge/fingerprint.js";
import type { Scenario } from "../src/knowledge/schema.js";
import type { ToolContext } from "../src/types.js";

const knowledge = loadKnowledge("data");
const ctx: ToolContext = { knowledge, docFetch: async () => ({ ok: true, excerpts: [] }) };

const base: Scenario = {
  id: "s", area: "customers", title: "t", method: "GET", path: "/v1/customers",
  authType: "app+user", headers: [{ name: "Authorization", required: true }],
  requestShape: null, responseShape: "Customer collection",
  examples: { curl: "c", csharp: "c", typescript: "t" },
  gotchas: ["one"], docUrl: "https://learn.microsoft.com/x", lastVerified: "2026-08-01",
};

test("re-verifying a scenario is not a change", () => {
  const reverified = { ...base, lastVerified: "2026-12-31" };
  expect(fingerprintScenario(reverified)).toBe(fingerprintScenario(base));
});

test("a reworded title is not a change either", () => {
  expect(fingerprintScenario({ ...base, title: "A clearer title" })).toBe(fingerprintScenario(base));
});

test("a changed route, header or gotcha is a change", () => {
  for (const mutated of [
    { ...base, path: "/v1/customers/{customer-id}" },
    { ...base, headers: [...base.headers, { name: "If-Match", required: false }] },
    { ...base, gotchas: ["one", "two"] },
    { ...base, authType: "app-only" as const },
    { ...base, responseShape: "Customer" },
  ]) {
    expect(fingerprintScenario(mutated), JSON.stringify(mutated).slice(0, 40)).not.toBe(fingerprintScenario(base));
  }
});

test("diffFingerprints separates added, changed and removed", () => {
  const before = { a: "1", b: "2", c: "3" };
  const after = { a: "1", b: "9", d: "4" };
  expect(diffFingerprints(before, after)).toEqual({ added: ["d"], changed: ["b"], removed: ["c"] });
});

test("the recorded history matches the pack it ships with", () => {
  const latest = knowledge.history[0];
  expect(latest).toBeTruthy();
  expect(latest?.scenarioCount).toBe(knowledge.scenarios.length);
});

test("every added or changed id in history is a scenario that exists", () => {
  const ids = new Set(knowledge.scenarios.map((s) => s.id));
  for (const release of knowledge.history) {
    for (const id of [...release.added, ...release.changed]) {
      expect(ids.has(id), `${release.version}: ${id}`).toBe(true);
    }
  }
});

test("pc_diff_pack expands ids into records a caller can act on", async () => {
  const r = await diffPack.run({}, ctx);
  const data = r.data as { releases: { added: { id: string; method: string; path: string }[] }[] };
  const first = data.releases[0]?.added[0];
  expect(first?.method).toBeTruthy();
  expect(first?.path.startsWith("/")).toBe(true);
});

test("pc_diff_pack narrowed to one id reports only that id", async () => {
  const r = await diffPack.run({ id: "get-price-sheet" }, ctx);
  const data = r.data as { releases: { changed: { id: string }[]; added: { id: string }[] }[] };
  for (const release of data.releases) {
    for (const entry of [...release.changed, ...release.added]) {
      expect(entry.id).toBe("get-price-sheet");
    }
  }
});

test("pc_diff_pack says so when nothing touched the id", async () => {
  const r = await diffPack.run({ id: "verify-mpn" }, ctx);
  const data = r.data as { releases: unknown[]; notes: string[] };
  expect(data.releases).toEqual([]);
  expect(data.notes.join(" ")).toContain("verify-mpn");
});

test("pc_diff_pack rejects a version it never recorded", async () => {
  const r = await diffPack.run({ since: "9.9.9" }, ctx);
  expect(r.ok).toBe(false);
});
