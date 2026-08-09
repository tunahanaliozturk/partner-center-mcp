import { test, expect } from "vitest";
import { loadKnowledge } from "../src/knowledge/load.js";
import { explainPolicy } from "../src/tools/explainPolicy.js";
import { readSnapshot } from "../src/docfacts/snapshot.js";
import type { ToolContext } from "../src/types.js";

const knowledge = loadKnowledge("data");
const ctx: ToolContext = { knowledge, docFetch: async () => ({ ok: true, excerpts: [] }) };

test("every policy names scenarios and errors that exist", () => {
  const scenarioIds = new Set(knowledge.scenarios.map((s) => s.id));
  const errorCodes = new Set(knowledge.errors.map((e) => e.errorCode));
  for (const policy of knowledge.policies) {
    for (const id of policy.relatedScenarios ?? []) {
      expect(scenarioIds.has(id), `${policy.id} -> ${id}`).toBe(true);
    }
    for (const code of policy.relatedErrors ?? []) {
      expect(errorCodes.has(code), `${policy.id} -> ${code}`).toBe(true);
    }
  }
});

/**
 * Policy pages are conceptual, so checkFields never looks at them. The drift
 * check is what keeps them honest, and it only watches pages that are in the
 * snapshot. A rule sourced from a page nobody is watching would rot silently.
 */
test("every policy is sourced from a page the drift check watches", () => {
  const snapshot = readSnapshot();
  const watched = new Set(Object.keys(snapshot.pages).map((u) => u.toLowerCase()));
  const unwatched = knowledge.policies
    .filter((p) => !watched.has(p.docUrl.toLowerCase()))
    .map((p) => `${p.id}: ${p.docUrl}`);
  expect(unwatched).toEqual([]);
});

test("a rule states what goes wrong, not just what is true", () => {
  // The consequence is the reason anyone is asking. Entries without one are
  // allowed, but the pack should not drift into being a glossary.
  const withConsequence = knowledge.policies.filter((p) => p.consequence !== undefined);
  expect(withConsequence.length / knowledge.policies.length).toBeGreaterThan(0.7);
});

test("pc_explain_policy ranks a question against the question each entry answers", async () => {
  const r = await explainPolicy.run({ question: "can I reduce seats on a software subscription" }, ctx);
  const answers = (r.data as { answers: { id: string }[] }).answers;
  expect(answers[0]?.id).toBe("software-subscriptions-no-seat-reduction");
});

test("pc_explain_policy finds the liability rule from how it would be asked", async () => {
  const r = await explainPolicy.run({ question: "customer bankrupt who pays microsoft" }, ctx);
  const ids = (r.data as { answers: { id: string }[] }).answers.map((a) => a.id);
  expect(ids).toContain("partner-owes-microsoft-when-customer-does-not-pay");
});

test("pc_explain_policy narrows by area", async () => {
  const r = await explainPolicy.run({ area: "pricing" }, ctx);
  const answers = (r.data as { answers: { area: string }[] }).answers;
  expect(answers.length).toBeGreaterThan(0);
  for (const a of answers) expect(a.area).toBe("pricing");
});

test("pc_explain_policy says so rather than guessing when nothing matches", async () => {
  const r = await explainPolicy.run({ question: "zzzz nonexistent topic qqqq" }, ctx);
  const data = r.data as { answers: unknown[]; notes: string[] };
  expect(data.answers).toEqual([]);
  expect(data.notes.join(" ")).toMatch(/nothing recorded/i);
});

test("the live subscription field outranks any documented window, and the tool says so", async () => {
  const r = await explainPolicy.run({ question: "how long to cancel" }, ctx);
  expect((r.data as { notes: string[] }).notes.join(" ")).toContain("cancellationAllowedUntilDate");
});
