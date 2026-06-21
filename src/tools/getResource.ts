import { z } from "zod";
import type { Tool } from "../types.js";
import { ok, notFound } from "../util/result.js";
import type { Knowledge } from "../knowledge/schema.js";

export const getResource: Tool = {
  name: "pc_get_resource",
  description: "Field dictionary for Partner Center resources (Customer, Subscription, Order, Invoice, CartLineItem): field names, types, and notes. Omit name to list all.",
  inputShape: { name: z.string().optional() },
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
