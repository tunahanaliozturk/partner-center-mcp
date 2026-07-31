import { test, expect } from "vitest";
import { readSnapshot } from "../src/docfacts/snapshot.js";
import { loadKnowledge } from "../src/knowledge/load.js";
import { checkFields } from "../src/docfacts/checks/fields.js";

/**
 * A ratchet on real verification coverage — the same data `npm run check-pack`
 * reads, run offline against the committed snapshot.
 *
 * `check-pack` is a gate on ERRORS. It stays green when a scenario stops being
 * verified, because "skipped" and "never verified" are not errors. That is
 * exactly how two scenarios once turned silently from verified into skipped
 * while CI stayed green. This test pins the counts so that regression is loud.
 *
 * THESE NUMBERS MAY ONLY MOVE IN THE IMPROVING DIRECTION: `verified` up,
 * `skipped`/`neverVerified` down. A drop in `verified` is the failure this
 * test exists to catch — do not "fix" it by editing the expectation to match
 * reality. Find out which scenario stopped being verified and why. Raising
 * `verified` (with the others falling to match) is the only edit that is ever
 * correct here.
 */
test("every scenario but the known conceptual-page skip is verified against the docs", () => {
  const knowledge = loadKnowledge("data");
  const findings = checkFields(readSnapshot(), knowledge.scenarios);

  const errors = findings.filter((f) => f.severity === "error");
  const unreadable = findings.filter((f) => f.kind === "field-skipped" && f.severity === "warning");
  const noSyntax = findings.filter((f) => f.kind === "field-skipped" && f.severity === "info");
  const unverified = findings.filter((f) => f.kind === "unverified");

  // Named in the failure output so a break says WHICH scenario regressed.
  expect(errors.map((f) => `${f.ref}: ${f.message}`)).toEqual([]);
  expect(unverified.map((f) => f.ref)).toEqual([]);
  expect(unreadable.map((f) => f.ref)).toEqual([]);

  // The single accepted skip: get-invoiceline-items is a conceptual page that
  // tabulates no request syntax. If this list shrinks, tighten it.
  expect(noSyntax.map((f) => f.ref)).toEqual(["get-invoice-billed-lineitems"]);

  const skipped = unreadable.length + noSyntax.length + unverified.length;
  expect(knowledge.scenarios.length).toBe(128);
  expect(knowledge.scenarios.length - skipped).toBe(127);
});
