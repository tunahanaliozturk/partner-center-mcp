import { test, expect } from "vitest";
import { allTools } from "../src/tools/index.js";

test("allTools exposes the Partner Center tools with unique names", () => {
  const names = allTools.map((t) => t.name).sort();
  expect(names).toEqual([
    "pc_auth_guidance", "pc_check_auth", "pc_diagnose", "pc_generate_call",
    "pc_get_reference", "pc_get_scenario", "pc_list_scenarios", "pc_lookup_error",
    "pc_migrate_from_sdk", "pc_plan_purchase", "pc_search_docs", "pc_validate_request",
  ]);
  expect(new Set(names).size).toBe(names.length);
});

test("every tool has a description and an input shape", () => {
  for (const t of allTools) {
    expect(t.description.length).toBeGreaterThan(0);
    expect(typeof t.inputShape).toBe("object");
  }
});
