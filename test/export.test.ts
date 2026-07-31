import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { loadKnowledge } from "../src/knowledge/load.js";

/**
 * OpenAPI allows one operation per path+method, and the pack deliberately holds
 * several intents on one URI: cancel, suspend, reactivate, quantity, autorenew,
 * scheduled changes and rename are all PATCH on the subscription. Before
 * x-variants the exporter overwrote them, so eight documented operations left
 * the generated spec without a word. This test is the guard on that.
 */
test("the generated OpenAPI spec loses no partner-center scenario", () => {
  const spec = JSON.parse(readFileSync("generated/openapi.json", "utf8"));
  const exported = new Set<string>();
  for (const methods of Object.values(spec.paths) as Record<string, unknown>[]) {
    for (const op of Object.values(methods) as Record<string, unknown>[]) {
      exported.add(op.operationId as string);
      for (const v of (op["x-variants"] ?? []) as { operationId: string }[]) exported.add(v.operationId);
    }
  }
  const expected = loadKnowledge("data").scenarios
    .filter((s) => (s.api ?? "partner-center") === "partner-center")
    .map((s) => s.id);
  expect(expected.filter((id) => !exported.has(id))).toEqual([]);
});

test("every generated Postman request maps to a scenario", () => {
  const collection = JSON.parse(readFileSync("generated/partner-center.postman_collection.json", "utf8"));
  const names = new Set<string>();
  for (const folder of collection.item as { item: { name: string }[] }[]) {
    for (const request of folder.item) names.add(request.name);
  }
  for (const s of loadKnowledge("data").scenarios) expect(names.has(s.title), s.id).toBe(true);
});
