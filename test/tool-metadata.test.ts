import { test, expect } from "vitest";
import { z } from "zod";
import { allTools } from "../src/tools/index.js";

// Tool metadata is the product here: an agent picks a tool from its description
// and schema alone, and Glama's quality score grades exactly that. These are
// ratchets — they exist so a future tool cannot land without the metadata that
// makes it usable.

const names = allTools.map((t) => t.name);

test.each(names)("%s declares a title distinct from its name", (name) => {
  const tool = allTools.find((t) => t.name === name);
  expect(tool?.title.length).toBeGreaterThan(2);
  expect(tool?.title).not.toBe(name);
});

test.each(names)("%s describes its purpose, when to use it, and how it behaves", (name) => {
  const tool = allTools.find((t) => t.name === name);
  const description = tool?.description ?? "";

  // Long enough to carry purpose + disambiguation + behaviour, short enough to
  // stay scannable in a tool picker.
  expect(description.length).toBeGreaterThanOrEqual(200);
  expect(description.length).toBeLessThanOrEqual(1400);

  // Must disambiguate itself against at least one sibling tool, which is what
  // stops an agent reaching for the wrong one.
  const siblings = names.filter((n) => n !== name);
  expect(siblings.some((n) => description.includes(n))).toBe(true);

  // Must disclose whether it reaches the network and that it does not mutate.
  expect(/offline|live|network|internet/i.test(description)).toBe(true);
  expect(/read-only|planning only|never executed|not executed|never sent|nothing is executed/i.test(description)).toBe(true);
});

test.each(names)("%s documents every input parameter", (name) => {
  const tool = allTools.find((t) => t.name === name);
  for (const [param, schema] of Object.entries(tool?.inputShape ?? {})) {
    const described = (schema as z.ZodType).description ?? "";
    expect(described.length, `${name}.${param} has no description`).toBeGreaterThanOrEqual(40);
  }
});

test.each(names)("%s declares an output schema over the standard envelope", (name) => {
  const tool = allTools.find((t) => t.name === name);
  const shape = tool?.outputShape ?? {};
  expect(Object.keys(shape)).toEqual(expect.arrayContaining(["ok", "data", "error"]));
  for (const [field, schema] of Object.entries(shape)) {
    expect((schema as z.ZodType).description?.length ?? 0, `${name} output.${field} has no description`).toBeGreaterThan(0);
  }
});

test.each(names)("%s declares honest behaviour annotations", (name) => {
  const tool = allTools.find((t) => t.name === name);
  const a = tool?.annotations;
  // This server only ever reads: it holds no credentials and calls no
  // Partner Center endpoint, so these two are invariants, not per-tool choices.
  expect(a?.readOnlyHint).toBe(true);
  expect(a?.destructiveHint).toBe(false);
  expect(typeof a?.idempotentHint).toBe("boolean");
  expect(typeof a?.openWorldHint).toBe("boolean");
  // Reaching the open world is exactly what makes a result non-reproducible.
  if (a?.openWorldHint) expect(a.idempotentHint).toBe(false);
});

test("every tool's declared output schema accepts the error envelope it can emit", () => {
  for (const tool of allTools) {
    const schema = z.object(tool.outputShape);
    const parsed = schema.safeParse({ ok: false, error: `No such thing in ${tool.name}.` });
    expect(parsed.success, `${tool.name} cannot represent its own failure result`).toBe(true);
  }
});

test("tools that can miss a lookup advertise suggestions in their output schema", () => {
  // notFound() returns `suggestions`; a tool whose schema omits it would fail
  // structured-output validation the first time a caller passes a bad id.
  const suggesting = allTools.filter((t) => "suggestions" in t.outputShape);
  expect(suggesting.map((t) => t.name).sort()).toEqual([
    "pc_auth_guidance", "pc_build_request", "pc_generate_call", "pc_get_enums",
    "pc_get_resource", "pc_get_scenario", "pc_lookup_error",
  ]);
});
