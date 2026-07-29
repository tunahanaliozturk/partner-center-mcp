import { z } from "zod";
import type { Tool } from "../types.js";
import { ok, notFound } from "../util/result.js";
import { envelope, OFFLINE } from "../util/schema.js";
import type { Knowledge } from "../knowledge/schema.js";

export const getEnums: Tool = {
  name: "pc_get_enums",
  title: "Look up enum values",
  description:
    "Return the accepted values for a Partner Center enum, each with a note on what it means — billingCycle, termDuration, targetView, segment, transitionType, subscriptionStatus, qualification, agreementType, billingType, provisioningStatus and more. " +
    "Use this before sending a request body so you send a value the API will accept, rather than guessing a plausible-looking string. " +
    "For the fields of a whole resource use pc_get_resource; for a pre-filled body skeleton use pc_build_request. " +
    "Read-only, offline, deterministic. Omitting `name` returns the index of every enum instead of one enum's values. " +
    "An unknown name returns ok:false with `suggestions` listing all valid enum names.",
  inputShape: {
    name: z.string().optional().describe(
      "Enum to expand, e.g. \"billingCycle\" or \"subscriptionStatus\". Matched case-insensitively. " +
      "Omit it to list every available enum with its description and value count, then call again with the one you want.",
    ),
  },
  outputShape: envelope(
    z.union([
      z.array(z.object({
        name: z.string().describe("Enum name to pass back in `name`."),
        description: z.string().describe("What the enum controls."),
        count: z.number().int().describe("How many values it has."),
      })).describe("The index of all enums, returned when `name` was omitted."),
      z.object({
        name: z.string().describe("Canonical enum name as stored, which may differ in casing from what you passed."),
        description: z.string().describe("What the enum controls."),
        values: z.array(z.object({
          value: z.string().describe("The literal string to send in a request."),
          note: z.string().optional().describe("What this value means or when it applies."),
        })).describe("Every accepted value."),
        docUrl: z.string().optional().describe("Microsoft Learn page documenting the enum."),
      }).describe("One expanded enum, returned when `name` was supplied."),
    ]),
    { suggests: true },
  ),
  annotations: OFFLINE,
  run(args, ctx) {
    const k = ctx.knowledge as Knowledge;
    if (!args.name) {
      return ok(Object.entries(k.enums).map(([name, e]) => ({ name, description: e.description, count: e.values.length })));
    }
    const key = Object.keys(k.enums).find((n) => n.toLowerCase() === String(args.name).toLowerCase());
    if (!key) return notFound(`No enum named "${args.name}".`, Object.keys(k.enums));
    return ok({ name: key, ...k.enums[key] });
  },
};
