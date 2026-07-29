import { z } from "zod";
import type { Tool } from "../types.js";
import { ok, notFound } from "../util/result.js";
import { envelope, OFFLINE } from "../util/schema.js";
import type { Knowledge } from "../knowledge/schema.js";

export const getResource: Tool = {
  name: "pc_get_resource",
  title: "Look up a resource's fields",
  description:
    "Return the field dictionary for a Partner Center resource — Customer, Subscription, Order, Invoice, CartLineItem and others — listing each field's name, type, and usage note. " +
    "Use this to understand a payload you received or to work out what a request body needs. " +
    "For the accepted values of an individual field use pc_get_enums, and for a ready-to-fill body skeleton for a specific operation use pc_build_request. " +
    "Read-only, offline, deterministic. Omitting `name` returns the index of every resource instead of one resource's fields. " +
    "An unknown name returns ok:false with `suggestions` listing all valid resource names.",
  inputShape: {
    name: z.string().optional().describe(
      "Resource to expand, e.g. \"Subscription\" or \"CartLineItem\". Matched case-insensitively. " +
      "Omit it to list every documented resource with its description and field count, then call again with the one you want.",
    ),
  },
  outputShape: envelope(
    z.union([
      z.array(z.object({
        name: z.string().describe("Resource name to pass back in `name`."),
        description: z.string().describe("What the resource represents."),
        fields: z.number().int().describe("How many documented fields it has."),
      })).describe("The index of all resources, returned when `name` was omitted."),
      z.object({
        name: z.string().describe("Canonical resource name as stored, which may differ in casing from what you passed."),
        description: z.string().describe("What the resource represents."),
        fields: z.array(z.object({
          name: z.string().describe("Field name as it appears in the JSON payload."),
          type: z.string().describe("Declared type of the field."),
          note: z.string().optional().describe("Constraints, accepted values, or gotchas."),
        })).describe("Every documented field on the resource."),
        docUrl: z.string().optional().describe("Microsoft Learn page documenting the resource."),
      }).describe("One expanded resource, returned when `name` was supplied."),
    ]),
    { suggests: true },
  ),
  annotations: OFFLINE,
  run(args, ctx) {
    const k = ctx.knowledge as Knowledge;
    if (!args.name) {
      return ok(Object.entries(k.resources).map(([name, r]) => ({ name, description: r.description, fields: r.fields.length })));
    }
    const key = Object.keys(k.resources).find((n) => n.toLowerCase() === String(args.name).toLowerCase());
    if (!key) return notFound(`No resource named "${args.name}".`, Object.keys(k.resources));
    return ok({ name: key, ...k.resources[key] });
  },
};
