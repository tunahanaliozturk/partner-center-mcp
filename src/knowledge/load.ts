import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  ScenarioSchema, ErrorEntrySchema, AuthSchema, SdkMapSchema, ReferenceSchema,
  EnumsSchema, DeprecationsSchema, ResourcesSchema, type Knowledge,
} from "./schema.js";

function read<T>(dir: string, file: string, schema: z.ZodType<T>): T {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(join(dir, file), "utf8"));
  } catch (e) {
    throw new Error(`${file}: cannot read or parse (${(e as Error).message})`);
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new Error(`${file}: invalid (${result.error.issues[0].path.join(".")}: ${result.error.issues[0].message})`);
  }
  return result.data;
}

export function loadKnowledge(dir: string): Knowledge {
  const scenarios = read(dir, "scenarios.json", z.object({ version: z.string(), scenarios: z.array(ScenarioSchema) })).scenarios;
  const errors = read(dir, "errors.json", z.object({ version: z.string(), errors: z.array(ErrorEntrySchema) })).errors;
  const auth = read(dir, "auth.json", AuthSchema.extend({ version: z.string() }));
  const sdkMap = read(dir, "sdk-map.json", SdkMapSchema.extend({ version: z.string() })).mappings;
  const reference = read(dir, "reference.json", ReferenceSchema);
  const enums = read(dir, "enums.json", EnumsSchema).enums;
  const deprecations = read(dir, "deprecations.json", DeprecationsSchema).items;
  const resources = read(dir, "resources.json", ResourcesSchema).resources;
  return { scenarios, errors, auth, sdkMap, reference, enums, deprecations, resources };
}
